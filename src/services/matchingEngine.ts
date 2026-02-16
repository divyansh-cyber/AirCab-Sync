import { RideRequest, RidePool, PoolMember, MatchResult } from '../models/types';
import { config } from '../config';
import {
  calculateDistance,
  calculateTotalDistance,
  optimizeRoute,
  areLocationsCompatible,
} from '../utils/distance';
import { logger } from '../logger';

/**
 * RIDE POOLING MATCHING ALGORITHM
 * 
 * APPROACH: Greedy Algorithm with Constraint Satisfaction
 * 
 * COMPLEXITY ANALYSIS:
 * - Time Complexity: O(n * m * log(m)) where:
 *   - n = number of pending ride requests
 *   - m = number of existing active pools
 *   - Sorting pools: O(m * log(m))
 *   - For each request, checking each pool: O(n * m)
 *   - Route optimization per check: O(k²) where k = max 8 stops (4 passengers * 2)
 * 
 * - Space Complexity: O(n + m + k)
 *   - Storing requests: O(n)
 *   - Storing pools: O(m)
 *   - Route data structures: O(k)
 * 
 * ALGORITHM STEPS:
 * 1. Filter available pools based on capacity constraints
 * 2. For each request, calculate compatibility with each pool
 * 3. Check detour constraints for all existing members
 * 4. Optimize route and verify total distance
 * 5. Select best match based on scoring function
 * 6. Create new pool if no suitable match found
 * 
 * CONSTRAINTS:
 * - Max passengers per pool: 4
 * - Max luggage per pool: 8
 * - Max detour per passenger: configurable (default 5km)
 * - Pickup must happen before dropoff for each passenger
 */

export interface PoolCandidate {
  pool: RidePool;
  existingMembers: PoolMember[];
  existingRequests: RideRequest[];
}

export class MatchingEngine {
  /**
   * Find best matching pool for a ride request
   * 
   * Time: O(m * k²) where m = pools, k = stops per pool
   * Space: O(m)
   */
  public async findBestMatch(
    request: RideRequest,
    availablePools: PoolCandidate[]
  ): Promise<PoolCandidate | null> {
    const compatiblePools: Array<{ pool: PoolCandidate; score: number }> = [];

    for (const poolCandidate of availablePools) {
      const { pool, existingMembers, existingRequests } = poolCandidate;

      // Step 1: Check capacity constraints O(1)
      if (!this.checkCapacityConstraints(pool, request)) {
        continue;
      }

      // Step 2: Check location compatibility O(k) where k = existing members
      if (!this.checkLocationCompatibility(request, existingRequests)) {
        continue;
      }

      // Step 3: Calculate route with new member O(k²)
      const routeAnalysis = this.analyzeRouteWithNewMember(
        request,
        existingRequests,
        existingMembers
      );

      if (!routeAnalysis.valid) {
        continue;
      }

      // Step 4: Calculate matching score O(1)
      const score = this.calculateMatchScore(routeAnalysis, pool, request);

      compatiblePools.push({ pool: poolCandidate, score });
    }

    // Step 5: Sort by score and return best match O(m * log(m))
    if (compatiblePools.length === 0) {
      return null;
    }

    compatiblePools.sort((a, b) => b.score - a.score);
    return compatiblePools[0].pool;
  }

  /**
   * Check if pool has capacity for new request
   * Time: O(1), Space: O(1)
   */
  private checkCapacityConstraints(pool: RidePool, request: RideRequest): boolean {
    const hasPassengerCapacity =
      pool.current_passenger_count + request.passenger_count <= pool.max_passengers;
    const hasLuggageCapacity =
      pool.current_luggage_count + request.luggage_count <= pool.max_luggage;

    return hasPassengerCapacity && hasLuggageCapacity;
  }

  /**
   * Check if request is geographically compatible with existing pool members
   * Time: O(k) where k = existing requests, Space: O(1)
   */
  private checkLocationCompatibility(
    newRequest: RideRequest,
    existingRequests: RideRequest[]
  ): boolean {
    if (existingRequests.length === 0) {
      return true;
    }

    const maxDetour = config.ridePooling.maxDetourToleranceKm;

    // Check compatibility with at least one existing request
    for (const existingReq of existingRequests) {
      const compatible = areLocationsCompatible(
        { lat: newRequest.pickup_latitude, lon: newRequest.pickup_longitude },
        { lat: newRequest.dropoff_latitude, lon: newRequest.dropoff_longitude },
        { lat: existingReq.pickup_latitude, lon: existingReq.pickup_longitude },
        { lat: existingReq.dropoff_latitude, lon: existingReq.dropoff_longitude },
        maxDetour
      );

      if (compatible) {
        return true;
      }
    }

    return existingRequests.length === 0;
  }

  /**
   * Analyze route with new member added
   * Time: O(k²) where k = total stops, Space: O(k)
   */
  private analyzeRouteWithNewMember(
    newRequest: RideRequest,
    existingRequests: RideRequest[],
    existingMembers: PoolMember[]
  ): {
    valid: boolean;
    route: any[];
    detours: Map<string, number>;
    totalDistance: number;
  } {
    // Build stops array
    const stops = [];

    // Add existing stops
    for (const req of existingRequests) {
      stops.push({
        id: `${req.id}-pickup`,
        lat: req.pickup_latitude,
        lon: req.pickup_longitude,
        type: 'pickup' as const,
        userId: req.user_id,
        requestId: req.id,
      });
      stops.push({
        id: `${req.id}-dropoff`,
        lat: req.dropoff_latitude,
        lon: req.dropoff_longitude,
        type: 'dropoff' as const,
        userId: req.user_id,
        requestId: req.id,
      });
    }

    // Add new request stops
    stops.push({
      id: `${newRequest.id}-pickup`,
      lat: newRequest.pickup_latitude,
      lon: newRequest.pickup_longitude,
      type: 'pickup' as const,
      userId: newRequest.user_id,
      requestId: newRequest.id,
    });
    stops.push({
      id: `${newRequest.id}-dropoff`,
      lat: newRequest.dropoff_latitude,
      lon: newRequest.dropoff_longitude,
      type: 'dropoff' as const,
      userId: newRequest.user_id,
      requestId: newRequest.id,
    });

    // Optimize route O(k²)
    const optimizedRoute = optimizeRoute(stops);
    const totalDistance = calculateTotalDistance(optimizedRoute);

    // Calculate detours for each member
    const detours = new Map<string, number>();

    for (const req of [...existingRequests, newRequest]) {
      const directDistance = calculateDistance(
        req.pickup_latitude,
        req.pickup_longitude,
        req.dropoff_latitude,
        req.dropoff_longitude
      );

      // Find this request's portion in the optimized route
      let pickupIdx = -1;
      let dropoffIdx = -1;
      for (let i = 0; i < optimizedRoute.length; i++) {
        if (optimizedRoute[i].id === req.id) {
          if (optimizedRoute[i].type === 'pickup') pickupIdx = i;
          if (optimizedRoute[i].type === 'dropoff') dropoffIdx = i;
        }
      }

      if (pickupIdx === -1 || dropoffIdx === -1) {
        return { valid: false, route: [], detours: new Map(), totalDistance: 0 };
      }

      // Calculate actual distance through the route
      let actualDistance = 0;
      for (let i = pickupIdx; i < dropoffIdx; i++) {
        actualDistance += calculateDistance(
          optimizedRoute[i].lat,
          optimizedRoute[i].lon,
          optimizedRoute[i + 1].lat,
          optimizedRoute[i + 1].lon
        );
      }

      const detour = actualDistance - directDistance;
      detours.set(req.id, detour);

      // Check detour constraint
      const maxDetour = Math.min(req.max_detour_km, config.ridePooling.maxDetourToleranceKm);
      if (detour > maxDetour) {
        logger.debug('Detour constraint violated', {
          requestId: req.id,
          detour,
          maxDetour,
        });
        return { valid: false, route: [], detours: new Map(), totalDistance: 0 };
      }
    }

    return {
      valid: true,
      route: optimizedRoute,
      detours,
      totalDistance,
    };
  }

  /**
   * Calculate matching score for ranking pools
   * Higher score = better match
   * Time: O(1), Space: O(1)
   */
  private calculateMatchScore(
    routeAnalysis: { detours: Map<string, number>; totalDistance: number },
    pool: RidePool,
    request: RideRequest
  ): number {
    // Factors:
    // 1. Lower average detour = higher score
    // 2. More passengers = higher score (better utilization)
    // 3. Shorter total route = higher score

    const avgDetour =
      Array.from(routeAnalysis.detours.values()).reduce((a, b) => a + b, 0) /
      routeAnalysis.detours.size;

    const utilizationScore = pool.current_passenger_count / pool.max_passengers;
    const detourScore = Math.max(0, 10 - avgDetour); // 10 points minus km of detour
    const distanceScore = Math.max(0, 50 - routeAnalysis.totalDistance); // 50 points minus total km

    return utilizationScore * 30 + detourScore * 40 + distanceScore * 30;
  }

  /**
   * Generate optimal pools for a batch of requests
   * Time: O(n²) where n = number of requests
   * Space: O(n)
   */
  public generateOptimalPools(requests: RideRequest[]): MatchResult[] {
    const pools: MatchResult[] = [];
    const assigned = new Set<string>();

    // Sort requests by timestamp (FIFO)
    const sortedRequests = [...requests].sort(
      (a, b) => a.requested_at.getTime() - b.requested_at.getTime()
    );

    for (const request of sortedRequests) {
      if (assigned.has(request.id)) continue;

      // Try to find compatible requests
      const compatible: RideRequest[] = [request];
      assigned.add(request.id);

      for (const otherRequest of sortedRequests) {
        if (assigned.has(otherRequest.id)) continue;
        if (compatible.length >= config.ridePooling.maxPassengersPerPool) break;

        // Check if compatible
        const isCompatible = this.checkLocationCompatibility(otherRequest, compatible);
        if (isCompatible) {
          const totalPassengers =
            compatible.reduce((sum, r) => sum + r.passenger_count, 0) +
            otherRequest.passenger_count;
          const totalLuggage =
            compatible.reduce((sum, r) => sum + r.luggage_count, 0) +
            otherRequest.luggage_count;

          if (
            totalPassengers <= config.ridePooling.maxPassengersPerPool &&
            totalLuggage <= config.ridePooling.maxLuggageCapacity
          ) {
            compatible.push(otherRequest);
            assigned.add(otherRequest.id);
          }
        }
      }

      logger.info(`Created pool with ${compatible.length} members`);
    }

    return pools;
  }
}

export const matchingEngine = new MatchingEngine();
