export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  created_at: Date;
  updated_at: Date;
}

export interface Location {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: 'airport' | 'city' | 'landmark';
  created_at: Date;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type RideStatus = 'pending' | 'matched' | 'confirmed' | 'cancelled' | 'completed';
export type PoolStatus = 'forming' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export interface RideRequest {
  id: string;
  user_id: string;
  pickup_location_id: string;
  dropoff_location_id: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_latitude: number;
  dropoff_longitude: number;
  passenger_count: number;
  luggage_count: number;
  max_detour_km: number;
  status: RideStatus;
  requested_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface RidePool {
  id: string;
  pool_code: string;
  status: PoolStatus;
  current_passenger_count: number;
  current_luggage_count: number;
  max_passengers: number;
  max_luggage: number;
  estimated_departure?: Date;
  actual_departure?: Date;
  route_distance_km?: number;
  estimated_duration_minutes?: number;
  created_at: Date;
  updated_at: Date;
}

export interface PoolMember {
  id: string;
  pool_id: string;
  ride_request_id: string;
  pickup_sequence: number;
  dropoff_sequence: number;
  detour_distance_km: number;
  price: number;
  joined_at: Date;
}

export interface PricingHistory {
  id: string;
  ride_request_id: string;
  base_fare: number;
  distance_fare: number;
  surge_multiplier: number;
  pool_discount: number;
  final_price: number;
  demand_factor: number;
  calculated_at: Date;
}

export interface CreateRideRequestDTO {
  user_id: string;
  pickup_location_id: string;
  dropoff_location_id: string;
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_latitude: number;
  dropoff_longitude: number;
  passenger_count: number;
  luggage_count: number;
  max_detour_km?: number;
}

export interface MatchResult {
  pool: RidePool;
  members: PoolMember[];
  total_savings: number;
  average_detour_km: number;
}
