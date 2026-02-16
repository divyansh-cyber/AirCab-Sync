import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'ride_pooling',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    poolMin: parseInt(process.env.DB_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '20', 10),
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  },

  ridePooling: {
    maxPassengersPerPool: parseInt(process.env.MAX_PASSENGERS_PER_POOL || '4', 10),
    maxLuggageCapacity: parseInt(process.env.MAX_LUGGAGE_CAPACITY || '8', 10),
    maxDetourToleranceKm: parseFloat(process.env.MAX_DETOUR_TOLERANCE_KM || '5'),
    baseFare: parseFloat(process.env.BASE_FARE || '50'),
    perKmRate: parseFloat(process.env.PER_KM_RATE || '15'),
    surgeMultiplierMax: parseFloat(process.env.SURGE_MULTIPLIER_MAX || '2.5'),
    poolDiscountPercent: parseFloat(process.env.POOL_DISCOUNT_PERCENT || '20'),
  },

  rateLimiting: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  concurrency: {
    maxConcurrentOperations: parseInt(process.env.MAX_CONCURRENT_OPERATIONS || '1000', 10),
  },
};
