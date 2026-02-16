/**
 * HAVERSINE DISTANCE CALCULATION
 * 
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 * 
 * Calculates the great-circle distance between two points on Earth
 * using the Haversine formula.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * ROUTE DETOUR CALCULATION
 * 
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 * 
 * Calculates the detour distance when adding a new pickup/dropoff
 * to an existing route.
 */
export function calculateDetour(
  currentRoute: Array<{ lat: number; lon: number }>,
  newPoint: { lat: number; lon: number }
): number {
  if (currentRoute.length === 0) return 0;

  // Calculate direct distance
  const directDistance = calculateDistance(
    currentRoute[0].lat,
    currentRoute[0].lon,
    currentRoute[currentRoute.length - 1].lat,
    currentRoute[currentRoute.length - 1].lon
  );

  // Calculate distance with new point
  let totalWithNewPoint = 0;
  const fullRoute = [...currentRoute, newPoint];
  for (let i = 0; i < fullRoute.length - 1; i++) {
    totalWithNewPoint += calculateDistance(
      fullRoute[i].lat,
      fullRoute[i].lon,
      fullRoute[i + 1].lat,
      fullRoute[i + 1].lon
    );
  }

  return totalWithNewPoint - directDistance;
}

/**
 * OPTIMIZED ROUTE CALCULATION USING NEAREST NEIGHBOR
 * 
 * Time Complexity: O(n²) where n is number of stops
 * Space Complexity: O(n)
 * 
 * Uses a greedy nearest-neighbor approach to optimize the route.
 * For small pools (max 4 passengers), this provides good results quickly.
 */
export function optimizeRoute(
  stops: Array<{ id: string; lat: number; lon: number; type: 'pickup' | 'dropoff'; userId: string }>
): Array<{ id: string; lat: number; lon: number; type: 'pickup' | 'dropoff'; userId: string }> {
  if (stops.length <= 1) return stops;

  const optimized: typeof stops = [];
  const visited = new Set<number>();
  
  // Start with the first pickup
  let currentIdx = 0;
  optimized.push(stops[currentIdx]);
  visited.add(currentIdx);

  // Constraint: Must pick up before drop off for each user
  const userPickedUp = new Set<string>();
  if (stops[currentIdx].type === 'pickup') {
    userPickedUp.add(stops[currentIdx].userId);
  }

  while (optimized.length < stops.length) {
    let nearestIdx = -1;
    let minDistance = Infinity;

    for (let i = 0; i < stops.length; i++) {
      if (visited.has(i)) continue;

      // Check constraint: can only drop off if user was picked up
      if (stops[i].type === 'dropoff' && !userPickedUp.has(stops[i].userId)) {
        continue;
      }

      const distance = calculateDistance(
        optimized[optimized.length - 1].lat,
        optimized[optimized.length - 1].lon,
        stops[i].lat,
        stops[i].lon
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestIdx = i;
      }
    }

    if (nearestIdx === -1) {
      // No valid next stop found, break constraint temporarily
      for (let i = 0; i < stops.length; i++) {
        if (!visited.has(i)) {
          nearestIdx = i;
          break;
        }
      }
    }

    optimized.push(stops[nearestIdx]);
    visited.add(nearestIdx);
    
    if (stops[nearestIdx].type === 'pickup') {
      userPickedUp.add(stops[nearestIdx].userId);
    }
  }

  return optimized;
}

/**
 * CALCULATE TOTAL ROUTE DISTANCE
 * 
 * Time Complexity: O(n) where n is number of stops
 * Space Complexity: O(1)
 */
export function calculateTotalDistance(
  route: Array<{ lat: number; lon: number }>
): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += calculateDistance(
      route[i].lat,
      route[i].lon,
      route[i + 1].lat,
      route[i + 1].lon
    );
  }
  return total;
}

/**
 * CHECK IF LOCATIONS ARE COMPATIBLE FOR POOLING
 * 
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function areLocationsCompatible(
  req1Pickup: { lat: number; lon: number },
  req1Dropoff: { lat: number; lon: number },
  req2Pickup: { lat: number; lon: number },
  req2Dropoff: { lat: number; lon: number },
  maxDetourKm: number
): boolean {
  // Check if pickups are close
  const pickupDistance = calculateDistance(
    req1Pickup.lat,
    req1Pickup.lon,
    req2Pickup.lat,
    req2Pickup.lon
  );

  // Check if dropoffs are in similar direction
  const dropoffDistance = calculateDistance(
    req1Dropoff.lat,
    req1Dropoff.lon,
    req2Dropoff.lat,
    req2Dropoff.lon
  );

  // Heuristic: pickups should be within maxDetour distance
  // and dropoffs should be within 2x maxDetour
  return pickupDistance <= maxDetourKm && dropoffDistance <= maxDetourKm * 2;
}
