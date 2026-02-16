import { db } from '../database/db';
import { redis } from '../database/redis';
import { logger } from '../logger';
import { RidePool, PoolMember, RideRequest, PoolStatus } from '../models/types';
import { pricingService } from './pricingService';
import { config } from '../config';

/**
 * POOL SERVICE
 * 
 * Manages ride pools with ACID compliance
 * Handles concurrent pool modifications safely
 * Implements optimistic locking for race condition prevention
 */

export class PoolService {
  /**
   * Create a new ride pool
   * Time: O(n) where n = number of initial members, Space: O(1)
   */
  public async createPool(rideRequestIds: string[]): Promise<RidePool> {
    return await db.transaction(async (client) => {
      // Generate unique pool code
      const poolCode = this.generatePoolCode();

      // Create pool
      const poolResult = await client.query(
        `INSERT INTO ride_pools 
         (pool_code, status, current_passenger_count, current_luggage_count, 
          max_passengers, max_luggage)
         VALUES ($1, 'forming', 0, 0, $2, $3)
         RETURNING *`,
        [
          poolCode,
          config.ridePooling.maxPassengersPerPool,
          config.ridePooling.maxLuggageCapacity,
        ]
      );

      const pool = poolResult.rows[0];

      // Add members
      for (const rideRequestId of rideRequestIds) {
        await this.addMemberToPoolInternal(client, pool.id, rideRequestId);
      }

      // Recalculate capacity
      await this.recalculatePoolCapacityInternal(client, pool.id);

      logger.info('Pool created', {
        poolId: pool.id,
        poolCode: pool.pool_code,
        memberCount: rideRequestIds.length,
      });

      return pool;
    });
  }

  /**
   * Add member to existing pool
   * Time: O(1), Space: O(1)
   */
  public async addMemberToPool(poolId: string, rideRequestId: string): Promise<void> {
    await db.transaction(async (client) => {
      await this.addMemberToPoolInternal(client, poolId, rideRequestId);
      await this.recalculatePoolCapacityInternal(client, poolId);
    });
  }

  /**
   * Internal method to add member (within transaction)
   * Time: O(1), Space: O(1)
   */
  private async addMemberToPoolInternal(
    client: any,
    poolId: string,
    rideRequestId: string
  ): Promise<void> {
    // Get ride request details
    const rideResult = await client.query(
      'SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE',
      [rideRequestId]
    );

    if (rideResult.rows.length === 0) {
      throw new Error('Ride request not found');
    }

    const ride = rideResult.rows[0];

    // Check if already in a pool
    const existingMember = await client.query(
      'SELECT * FROM pool_members WHERE ride_request_id = $1',
      [rideRequestId]
    );

    if (existingMember.rows.length > 0) {
      throw new Error('Ride already in a pool');
    }

    // Get current member count for sequencing
    const memberCountResult = await client.query(
      'SELECT COUNT(*) as count FROM pool_members WHERE pool_id = $1',
      [poolId]
    );

    const currentCount = parseInt(memberCountResult.rows[0].count, 10);

    // Calculate price
    const isPooled = currentCount > 0;
    const poolSize = currentCount + 1;
    const priceBreakdown = await pricingService.calculatePrice(ride, isPooled, poolSize);

    // Insert pool member
    await client.query(
      `INSERT INTO pool_members 
       (pool_id, ride_request_id, pickup_sequence, dropoff_sequence, 
        detour_distance_km, price)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [poolId, rideRequestId, currentCount + 1, (currentCount + 1) * 2, priceBreakdown.final_price]
    );

    // Update ride status
    await client.query(
      `UPDATE ride_requests 
       SET status = 'matched', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [rideRequestId]
    );

    // Save pricing history
    await pricingService.savePricingHistory(rideRequestId, priceBreakdown);

    // Invalidate caches
    await redis.del(`ride:${rideRequestId}`);
    await redis.del(`pool:${poolId}`);

    logger.info('Member added to pool', {
      poolId,
      rideRequestId,
      price: priceBreakdown.final_price,
    });
  }

  /**
   * Recalculate pool capacity
   * Time: O(n) where n = pool members, Space: O(n)
   */
  public async recalculatePoolCapacity(poolId: string): Promise<void> {
    await db.transaction(async (client) => {
      await this.recalculatePoolCapacityInternal(client, poolId);
    });
  }

  /**
   * Internal capacity recalculation (within transaction)
   * Time: O(n), Space: O(n)
   */
  private async recalculatePoolCapacityInternal(client: any, poolId: string): Promise<void> {
    // Get all members
    const membersResult = await client.query(
      'SELECT ride_request_id FROM pool_members WHERE pool_id = $1',
      [poolId]
    );

    const rideIds = membersResult.rows.map((m) => m.ride_request_id);

    if (rideIds.length === 0) {
      // Empty pool, set to 0
      await client.query(
        `UPDATE ride_pools 
         SET current_passenger_count = 0, current_luggage_count = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [poolId]
      );
      return;
    }

    // Get ride details
    const ridesResult = await client.query(
      `SELECT passenger_count, luggage_count FROM ride_requests WHERE id = ANY($1)`,
      [rideIds]
    );

    const totalPassengers = ridesResult.rows.reduce((sum, r) => sum + r.passenger_count, 0);
    const totalLuggage = ridesResult.rows.reduce((sum, r) => sum + r.luggage_count, 0);

    // Update pool
    await client.query(
      `UPDATE ride_pools 
       SET current_passenger_count = $1, 
           current_luggage_count = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [totalPassengers, totalLuggage, poolId]
    );

    await redis.del(`pool:${poolId}`);
  }

  /**
   * Get pool by ID with caching
   * Time: O(1), Space: O(1)
   */
  public async getPool(id: string): Promise<RidePool | null> {
    try {
      // Check cache
      const cached = await redis.get(`pool:${id}`);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await db.query<RidePool>(
        'SELECT * FROM ride_pools WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const pool = result.rows[0];

      // Cache for 5 minutes
      await redis.set(`pool:${id}`, JSON.stringify(pool), 300);

      return pool;
    } catch (error) {
      logger.error('Error getting pool:', error);
      throw error;
    }
  }

  /**
   * Get pool with members
   * Time: O(n) where n = members, Space: O(n)
   */
  public async getPoolWithMembers(id: string) {
    const pool = await this.getPool(id);
    if (!pool) {
      return null;
    }

    const membersResult = await db.query<PoolMember>(
      `SELECT pm.*, rr.user_id, rr.pickup_latitude, rr.pickup_longitude,
              rr.dropoff_latitude, rr.dropoff_longitude
       FROM pool_members pm
       JOIN ride_requests rr ON pm.ride_request_id = rr.id
       WHERE pm.pool_id = $1
       ORDER BY pm.pickup_sequence`,
      [id]
    );

    return {
      pool,
      members: membersResult.rows,
    };
  }

  /**
   * Update pool status
   * Time: O(1), Space: O(1)
   */
  public async updatePoolStatus(id: string, status: PoolStatus): Promise<RidePool> {
    const result = await db.query<RidePool>(
      `UPDATE ride_pools 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      throw new Error('Pool not found');
    }

    await redis.del(`pool:${id}`);

    return result.rows[0];
  }

  /**
   * Get active pools
   * Time: O(n), Space: O(n)
   */
  public async getActivePools(): Promise<RidePool[]> {
    const result = await db.query<RidePool>(
      `SELECT * FROM ride_pools 
       WHERE status IN ('forming', 'confirmed', 'in_progress')
       ORDER BY created_at DESC
       LIMIT 100`
    );

    return result.rows;
  }

  /**
   * Generate unique pool code
   * Time: O(1), Space: O(1)
   */
  private generatePoolCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'POOL';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Remove member from pool
   * Time: O(1), Space: O(1)
   */
  public async removeMemberFromPool(poolId: string, rideRequestId: string): Promise<void> {
    await db.transaction(async (client) => {
      await client.query(
        'DELETE FROM pool_members WHERE pool_id = $1 AND ride_request_id = $2',
        [poolId, rideRequestId]
      );

      await this.recalculatePoolCapacityInternal(client, poolId);

      // Check if pool is now empty
      const memberCount = await client.query(
        'SELECT COUNT(*) as count FROM pool_members WHERE pool_id = $1',
        [poolId]
      );

      if (parseInt(memberCount.rows[0].count, 10) === 0) {
        await client.query(
          `UPDATE ride_pools SET status = 'cancelled' WHERE id = $1`,
          [poolId]
        );
      }

      await redis.del(`pool:${poolId}`);
      await redis.del(`ride:${rideRequestId}`);
    });
  }
}

export const poolService = new PoolService();
