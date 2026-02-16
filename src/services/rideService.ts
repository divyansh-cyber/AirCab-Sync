import { db } from '../database/db';
import { redis } from '../database/redis';
import { logger } from '../logger';
import {
  RideRequest,
  RidePool,
  PoolMember,
  CreateRideRequestDTO,
  RideStatus,
} from '../models/types';
import { matchingEngine, PoolCandidate } from './matchingEngine';
import { pricingService } from './pricingService';
import { poolService } from './poolService';

/**
 * RIDE SERVICE
 * 
 * Handles all ride request operations with concurrency safety
 * Uses database transactions for atomicity
 * Implements optimistic locking for concurrent updates
 */

export class RideService {
  /**
   * Create a new ride request
   * Time: O(1) for database insert + O(m * k²) for matching
   * Space: O(1)
   */
  public async createRideRequest(data: CreateRideRequestDTO): Promise<RideRequest> {
    return await db.transaction(async (client) => {
      // Insert ride request
      const result = await client.query<RideRequest>(
        `INSERT INTO ride_requests 
         (user_id, pickup_location_id, dropoff_location_id, 
          pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
          passenger_count, luggage_count, max_detour_km, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
         RETURNING *`,
        [
          data.user_id,
          data.pickup_location_id,
          data.dropoff_location_id,
          data.pickup_latitude,
          data.pickup_longitude,
          data.dropoff_latitude,
          data.dropoff_longitude,
          data.passenger_count,
          data.luggage_count,
          data.max_detour_km || 5.0,
        ]
      );

      const rideRequest = result.rows[0];

      logger.info('Ride request created', {
        rideRequestId: rideRequest.id,
        userId: data.user_id,
      });

      // Invalidate cache
      await redis.del(`ride:${rideRequest.id}`);

      // Trigger async matching
      this.triggerMatching(rideRequest.id).catch((error) => {
        logger.error('Error triggering matching:', error);
      });

      return rideRequest;
    });
  }

  /**
   * Trigger matching process for a ride request
   * Uses eventual consistency - matching happens asynchronously
   * Time: O(m * k²), Space: O(m)
   */
  private async triggerMatching(rideRequestId: string): Promise<void> {
    try {
      // Get the ride request
      const request = await this.getRideRequest(rideRequestId);
      if (!request || request.status !== 'pending') {
        return;
      }

      // Get available pools with FOR UPDATE to prevent concurrent modifications
      const availablePools = await this.getAvailablePools();

      // Find best match
      const bestMatch = await matchingEngine.findBestMatch(request, availablePools);

      if (bestMatch) {
        // Add to existing pool
        await poolService.addMemberToPool(bestMatch.pool.id, rideRequestId);
        logger.info('Ride matched to existing pool', {
          rideRequestId,
          poolId: bestMatch.pool.id,
        });
      } else {
        // Create new pool
        const newPool = await poolService.createPool([rideRequestId]);
        logger.info('Created new pool for ride', {
          rideRequestId,
          poolId: newPool.id,
        });
      }
    } catch (error) {
      logger.error('Error in matching process:', error);
      throw error;
    }
  }

  /**
   * Get available pools for matching
   * Time: O(m) where m = number of pools, Space: O(m)
   */
  private async getAvailablePools(): Promise<PoolCandidate[]> {
    const poolsResult = await db.query<RidePool>(
      `SELECT * FROM ride_pools 
       WHERE status IN ('forming', 'confirmed')
       AND current_passenger_count < max_passengers
       ORDER BY created_at ASC
       LIMIT 50`
    );

    const candidates: PoolCandidate[] = [];

    for (const pool of poolsResult.rows) {
      const membersResult = await db.query<PoolMember>(
        'SELECT * FROM pool_members WHERE pool_id = $1',
        [pool.id]
      );

      const requestIds = membersResult.rows.map((m) => m.ride_request_id);
      const requestsResult = await db.query<RideRequest>(
        `SELECT * FROM ride_requests WHERE id = ANY($1)`,
        [requestIds]
      );

      candidates.push({
        pool,
        existingMembers: membersResult.rows,
        existingRequests: requestsResult.rows,
      });
    }

    return candidates;
  }

  /**
   * Get ride request by ID with caching
   * Time: O(1), Space: O(1)
   */
  public async getRideRequest(id: string): Promise<RideRequest | null> {
    try {
      // Check cache first
      const cached = await redis.get(`ride:${id}`);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await db.query<RideRequest>(
        'SELECT * FROM ride_requests WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const rideRequest = result.rows[0];

      // Cache for 5 minutes
      await redis.set(`ride:${id}`, JSON.stringify(rideRequest), 300);

      return rideRequest;
    } catch (error) {
      logger.error('Error getting ride request:', error);
      throw error;
    }
  }

  /**
   * Cancel a ride request
   * Handles concurrent cancellations with optimistic locking
   * Time: O(1), Space: O(1)
   */
  public async cancelRideRequest(id: string): Promise<RideRequest> {
    return await db.transaction(async (client) => {
      // Lock the row for update
      const result = await client.query<RideRequest>(
        `SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (result.rows.length === 0) {
        throw new Error('Ride request not found');
      }

      const rideRequest = result.rows[0];

      if (rideRequest.status === 'cancelled') {
        throw new Error('Ride request already cancelled');
      }

      if (rideRequest.status === 'completed') {
        throw new Error('Cannot cancel completed ride');
      }

      // Update status
      const updateResult = await client.query<RideRequest>(
        `UPDATE ride_requests 
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      const updatedRequest = updateResult.rows[0];

      // Remove from pool if matched
      if (rideRequest.status === 'matched') {
        await client.query(
          `DELETE FROM pool_members WHERE ride_request_id = $1`,
          [id]
        );

        // Update pool counts
        const poolResult = await client.query<{ pool_id: string }>(
          `SELECT pool_id FROM pool_members WHERE ride_request_id = $1`,
          [id]
        );

        if (poolResult.rows.length > 0) {
          const poolId = poolResult.rows[0].pool_id;
          await poolService.recalculatePoolCapacity(poolId);
        }
      }

      // Invalidate cache
      await redis.del(`ride:${id}`);

      logger.info('Ride request cancelled', {
        rideRequestId: id,
        previousStatus: rideRequest.status,
      });

      return updatedRequest;
    });
  }

  /**
   * Update ride request status
   * Time: O(1), Space: O(1)
   */
  public async updateRideStatus(id: string, status: RideStatus): Promise<RideRequest> {
    const result = await db.query<RideRequest>(
      `UPDATE ride_requests 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      throw new Error('Ride request not found');
    }

    // Invalidate cache
    await redis.del(`ride:${id}`);

    return result.rows[0];
  }

  /**
   * Get ride requests by user
   * Time: O(n) where n = user's rides, Space: O(n)
   */
  public async getRidesByUser(userId: string): Promise<RideRequest[]> {
    const result = await db.query<RideRequest>(
      `SELECT * FROM ride_requests 
       WHERE user_id = $1 
       ORDER BY requested_at DESC 
       LIMIT 50`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Get pending ride requests
   * Time: O(n), Space: O(n)
   */
  public async getPendingRides(): Promise<RideRequest[]> {
    const result = await db.query<RideRequest>(
      `SELECT * FROM ride_requests 
       WHERE status = 'pending' 
       ORDER BY requested_at ASC`
    );

    return result.rows;
  }

  /**
   * Get ride with pricing
   * Time: O(1), Space: O(1)
   */
  public async getRideWithPricing(id: string) {
    const ride = await this.getRideRequest(id);
    if (!ride) {
      return null;
    }

    const pricing = await pricingService.getPricingHistory(id);

    return {
      ride,
      pricing,
    };
  }
}

export const rideService = new RideService();
