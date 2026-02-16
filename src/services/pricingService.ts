import { config } from '../config';
import { RideRequest, PricingHistory } from '../models/types';
import { calculateDistance } from '../utils/distance';
import { db } from '../database/db';
import { redis } from '../database/redis';
import { logger } from '../logger';

/**
 * DYNAMIC PRICING ENGINE
 * 
 * PRICING FORMULA:
 * Final Price = (Base Fare + (Distance × Per KM Rate)) × Surge Multiplier - Pool Discount
 * 
 * SURGE MULTIPLIER CALCULATION:
 * - Based on demand/supply ratio
 * - Time of day factor (peak hours)
 * - Real-time request volume
 * - Formula: 1.0 + (demand_factor × 0.5) capped at MAX_SURGE
 * 
 * POOL DISCOUNT:
 * - Percentage discount for sharing rides
 * - Calculated as: Original Price × Pool Discount %
 * - More riders = more discount (up to 30%)
 * 
 * Time Complexity: O(1) for calculation
 * Space Complexity: O(1)
 */

export interface PriceBreakdown {
  base_fare: number;
  distance_fare: number;
  subtotal: number;
  surge_multiplier: number;
  surge_amount: number;
  pool_discount: number;
  final_price: number;
  demand_factor: number;
  distance_km: number;
}

export class PricingService {
  /**
   * Calculate price for a ride request
   * Time: O(1), Space: O(1)
   */
  public async calculatePrice(
    request: RideRequest,
    isPooled: boolean = false,
    poolSize: number = 1
  ): Promise<PriceBreakdown> {
    // Calculate distance
    const distance = calculateDistance(
      request.pickup_latitude,
      request.pickup_longitude,
      request.dropoff_latitude,
      request.dropoff_longitude
    );

    // Get current demand factor
    const demandFactor = await this.getDemandFactor();

    // Base calculations
    const baseFare = config.ridePooling.baseFare;
    const distanceFare = distance * config.ridePooling.perKmRate;
    const subtotal = baseFare + distanceFare;

    // Calculate surge multiplier
    const surgeMultiplier = this.calculateSurgeMultiplier(demandFactor);
    const surgeAmount = subtotal * (surgeMultiplier - 1);

    // Calculate pool discount
    let poolDiscount = 0;
    if (isPooled) {
      const discountPercent = this.calculatePoolDiscount(poolSize);
      poolDiscount = (subtotal + surgeAmount) * (discountPercent / 100);
    }

    // Final price
    const finalPrice = Math.max(0, subtotal + surgeAmount - poolDiscount);

    const breakdown: PriceBreakdown = {
      base_fare: baseFare,
      distance_fare: distanceFare,
      subtotal,
      surge_multiplier: surgeMultiplier,
      surge_amount: surgeAmount,
      pool_discount: poolDiscount,
      final_price: parseFloat(finalPrice.toFixed(2)),
      demand_factor: demandFactor,
      distance_km: parseFloat(distance.toFixed(2)),
    };

    // Log pricing calculation
    logger.debug('Price calculated', {
      requestId: request.id,
      breakdown,
    });

    return breakdown;
  }

  /**
   * Calculate surge multiplier based on demand
   * Formula: 1.0 + (demand_factor × 0.5)
   * Time: O(1), Space: O(1)
   */
  private calculateSurgeMultiplier(demandFactor: number): number {
    const baseMultiplier = 1.0;
    const surgeImpact = 0.5; // How much demand affects surge
    const calculatedSurge = baseMultiplier + demandFactor * surgeImpact;
    
    // Cap at maximum surge
    return Math.min(calculatedSurge, config.ridePooling.surgeMultiplierMax);
  }

  /**
   * Calculate pool discount based on pool size
   * More riders = more discount
   * Time: O(1), Space: O(1)
   */
  private calculatePoolDiscount(poolSize: number): number {
    const baseDiscount = config.ridePooling.poolDiscountPercent;
    
    // Increase discount for larger pools
    // 2 riders: 20%, 3 riders: 25%, 4 riders: 30%
    const bonusDiscount = (poolSize - 1) * 5;
    return Math.min(baseDiscount + bonusDiscount, 30);
  }

  /**
   * Get current demand factor from Redis cache
   * Demand factor ranges from 0.0 (no demand) to 2.0 (very high demand)
   * Time: O(1), Space: O(1)
   */
  private async getDemandFactor(): Promise<number> {
    try {
      const cached = await redis.get('demand:factor');
      if (cached) {
        return parseFloat(cached);
      }

      // Calculate demand factor based on recent requests
      const demandFactor = await this.calculateDemandFactor();
      await redis.set('demand:factor', demandFactor.toString(), 60); // Cache for 60 seconds
      
      return demandFactor;
    } catch (error) {
      logger.error('Error getting demand factor:', error);
      return 1.0; // Default to normal demand
    }
  }

  /**
   * Calculate real-time demand factor
   * Based on: number of pending requests, time of day, historical patterns
   * Time: O(1) with database query, Space: O(1)
   */
  private async calculateDemandFactor(): Promise<number> {
    try {
      // Count pending requests in last 5 minutes
      const result = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count 
         FROM ride_requests 
         WHERE status = 'pending' 
         AND requested_at > NOW() - INTERVAL '5 minutes'`
      );

      const pendingCount = parseInt(result.rows[0]?.count || '0', 10);

      // Time of day factor (peak hours: 7-9 AM, 5-8 PM)
      const hour = new Date().getHours();
      let timeOfDayFactor = 1.0;
      if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20)) {
        timeOfDayFactor = 1.5;
      }

      // Request volume factor
      // 0-10 requests: 0.5, 11-30: 1.0, 31-50: 1.5, 50+: 2.0
      let volumeFactor = 0.5;
      if (pendingCount > 50) volumeFactor = 2.0;
      else if (pendingCount > 30) volumeFactor = 1.5;
      else if (pendingCount > 10) volumeFactor = 1.0;

      // Combined demand factor
      const demandFactor = (volumeFactor + timeOfDayFactor) / 2;

      logger.debug('Demand factor calculated', {
        pendingCount,
        hour,
        timeOfDayFactor,
        volumeFactor,
        demandFactor,
      });

      return Math.min(demandFactor, 2.0);
    } catch (error) {
      logger.error('Error calculating demand factor:', error);
      return 1.0;
    }
  }

  /**
   * Save pricing history to database
   * Time: O(1), Space: O(1)
   */
  public async savePricingHistory(
    rideRequestId: string,
    breakdown: PriceBreakdown
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO pricing_history 
         (ride_request_id, base_fare, distance_fare, surge_multiplier, 
          pool_discount, final_price, demand_factor)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rideRequestId,
          breakdown.base_fare,
          breakdown.distance_fare,
          breakdown.surge_multiplier,
          breakdown.pool_discount,
          breakdown.final_price,
          breakdown.demand_factor,
        ]
      );
    } catch (error) {
      logger.error('Error saving pricing history:', error);
    }
  }

  /**
   * Get pricing history for a ride request
   * Time: O(1), Space: O(1)
   */
  public async getPricingHistory(rideRequestId: string): Promise<PricingHistory | null> {
    try {
      const result = await db.query<PricingHistory>(
        `SELECT * FROM pricing_history 
         WHERE ride_request_id = $1 
         ORDER BY calculated_at DESC 
         LIMIT 1`,
        [rideRequestId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting pricing history:', error);
      return null;
    }
  }

  /**
   * Update demand metrics
   * Called periodically to update demand tracking
   * Time: O(1), Space: O(1)
   */
  public async updateDemandMetrics(): Promise<void> {
    try {
      const demandFactor = await this.calculateDemandFactor();
      await redis.set('demand:factor', demandFactor.toString(), 60);
      
      // Store in metrics table for analytics
      await db.query(
        `INSERT INTO metrics (metric_type, value) VALUES ('demand_factor', $1)`,
        [demandFactor]
      );
    } catch (error) {
      logger.error('Error updating demand metrics:', error);
    }
  }
}

export const pricingService = new PricingService();
