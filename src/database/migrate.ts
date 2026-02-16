import { db } from './db';
import { logger } from '../logger';

const schema = `
-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Locations Table
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('airport', 'city', 'landmark')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ride Requests Table
CREATE TABLE IF NOT EXISTS ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup_location_id UUID NOT NULL REFERENCES locations(id),
  dropoff_location_id UUID NOT NULL REFERENCES locations(id),
  pickup_latitude DECIMAL(10, 8) NOT NULL,
  pickup_longitude DECIMAL(11, 8) NOT NULL,
  dropoff_latitude DECIMAL(10, 8) NOT NULL,
  dropoff_longitude DECIMAL(11, 8) NOT NULL,
  passenger_count INTEGER NOT NULL DEFAULT 1 CHECK (passenger_count > 0 AND passenger_count <= 4),
  luggage_count INTEGER NOT NULL DEFAULT 0 CHECK (luggage_count >= 0 AND luggage_count <= 4),
  max_detour_km DECIMAL(8, 2) NOT NULL DEFAULT 5.0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'matched', 'confirmed', 'cancelled', 'completed')),
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ride Pools Table
CREATE TABLE IF NOT EXISTS ride_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_code VARCHAR(20) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'forming' 
    CHECK (status IN ('forming', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  current_passenger_count INTEGER NOT NULL DEFAULT 0,
  current_luggage_count INTEGER NOT NULL DEFAULT 0,
  max_passengers INTEGER NOT NULL DEFAULT 4,
  max_luggage INTEGER NOT NULL DEFAULT 8,
  estimated_departure TIMESTAMP,
  actual_departure TIMESTAMP,
  route_distance_km DECIMAL(10, 2),
  estimated_duration_minutes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pool Members Table (Junction table for ride_requests and ride_pools)
CREATE TABLE IF NOT EXISTS pool_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES ride_pools(id) ON DELETE CASCADE,
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  pickup_sequence INTEGER NOT NULL,
  dropoff_sequence INTEGER NOT NULL,
  detour_distance_km DECIMAL(8, 2) NOT NULL DEFAULT 0,
  price DECIMAL(10, 2) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pool_id, ride_request_id)
);

-- Pricing History Table
CREATE TABLE IF NOT EXISTS pricing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  base_fare DECIMAL(10, 2) NOT NULL,
  distance_fare DECIMAL(10, 2) NOT NULL,
  surge_multiplier DECIMAL(4, 2) NOT NULL DEFAULT 1.0,
  pool_discount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  final_price DECIMAL(10, 2) NOT NULL,
  demand_factor DECIMAL(4, 2) NOT NULL DEFAULT 1.0,
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance Metrics Table
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type VARCHAR(100) NOT NULL,
  value DECIMAL(15, 6) NOT NULL,
  metadata JSONB,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Performance Optimization

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Ride Requests
CREATE INDEX IF NOT EXISTS idx_ride_requests_user_id ON ride_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_ride_requests_status ON ride_requests(status);
CREATE INDEX IF NOT EXISTS idx_ride_requests_requested_at ON ride_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_requests_status_requested_at ON ride_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_requests_pickup_location ON ride_requests(pickup_location_id);
CREATE INDEX IF NOT EXISTS idx_ride_requests_dropoff_location ON ride_requests(dropoff_location_id);
-- Geospatial index for location-based queries
CREATE INDEX IF NOT EXISTS idx_ride_requests_pickup_coords ON ride_requests(pickup_latitude, pickup_longitude);
CREATE INDEX IF NOT EXISTS idx_ride_requests_dropoff_coords ON ride_requests(dropoff_latitude, dropoff_longitude);

-- Ride Pools
CREATE INDEX IF NOT EXISTS idx_ride_pools_status ON ride_pools(status);
CREATE INDEX IF NOT EXISTS idx_ride_pools_created_at ON ride_pools(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_pools_pool_code ON ride_pools(pool_code);

-- Pool Members
CREATE INDEX IF NOT EXISTS idx_pool_members_pool_id ON pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_ride_request_id ON pool_members(ride_request_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_pool_ride ON pool_members(pool_id, ride_request_id);

-- Pricing History
CREATE INDEX IF NOT EXISTS idx_pricing_history_ride_request ON pricing_history(ride_request_id);
CREATE INDEX IF NOT EXISTS idx_pricing_history_calculated_at ON pricing_history(calculated_at DESC);

-- Metrics
CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_recorded_at ON metrics(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_type_recorded ON metrics(metric_type, recorded_at DESC);

-- Locations
CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);
CREATE INDEX IF NOT EXISTS idx_locations_coords ON locations(latitude, longitude);

-- Functions and Triggers

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ride_requests_updated_at BEFORE UPDATE ON ride_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ride_pools_updated_at BEFORE UPDATE ON ride_pools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

export async function migrate(): Promise<void> {
  try {
    logger.info('Starting database migration...');
    await db.query(schema);
    logger.info('Database migration completed successfully');
  } catch (error) {
    logger.error('Database migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      logger.info('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration script failed:', error);
      process.exit(1);
    });
}
