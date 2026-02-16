import { db } from './db';
import { logger } from '../logger';

/**
 * SEED DATA FOR TESTING
 * 
 * Creates sample users, locations, and ride requests
 * for testing the ride pooling system
 */

async function seed(): Promise<void> {
  try {
    logger.info('Starting database seeding...');

    // Create sample users
    const users = [
      { name: 'John Doe', email: 'john.doe@example.com', phone: '+1234567890' },
      { name: 'Jane Smith', email: 'jane.smith@example.com', phone: '+1234567891' },
      { name: 'Bob Johnson', email: 'bob.johnson@example.com', phone: '+1234567892' },
      { name: 'Alice Williams', email: 'alice.w@example.com', phone: '+1234567893' },
      { name: 'Charlie Brown', email: 'charlie.b@example.com', phone: '+1234567894' },
      { name: 'Diana Prince', email: 'diana.p@example.com', phone: '+1234567895' },
      { name: 'Eve Davis', email: 'eve.d@example.com', phone: '+1234567896' },
      { name: 'Frank Miller', email: 'frank.m@example.com', phone: '+1234567897' },
    ];

    const userIds: string[] = [];
    for (const user of users) {
      const result = await db.query(
        `INSERT INTO users (name, email, phone) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (email) DO UPDATE SET name = $1
         RETURNING id`,
        [user.name, user.email, user.phone]
      );
      userIds.push(result.rows[0].id);
    }
    logger.info(`Created ${userIds.length} users`);

    // Create sample locations
    const locations = [
      { name: 'JFK Airport', latitude: 40.6413, longitude: -73.7781, type: 'airport' },
      { name: 'Manhattan Downtown', latitude: 40.7589, longitude: -73.9851, type: 'city' },
      { name: 'Brooklyn Heights', latitude: 40.6962, longitude: -73.9942, type: 'city' },
      { name: 'Queens Center', latitude: 40.7340, longitude: -73.8698, type: 'city' },
      { name: 'Times Square', latitude: 40.7580, longitude: -73.9855, type: 'landmark' },
      { name: 'Central Park', latitude: 40.7829, longitude: -73.9654, type: 'landmark' },
      { name: 'LaGuardia Airport', latitude: 40.7769, longitude: -73.8740, type: 'airport' },
      { name: 'Newark Airport', latitude: 40.6895, longitude: -74.1745, type: 'airport' },
      { name: 'Jersey City', latitude: 40.7178, longitude: -74.0431, type: 'city' },
      { name: 'Bronx Zoo', latitude: 40.8506, longitude: -73.8769, type: 'landmark' },
    ];

    const locationIds: string[] = [];
    for (const location of locations) {
      const result = await db.query(
        `INSERT INTO locations (name, latitude, longitude, type) 
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [location.name, location.latitude, location.longitude, location.type]
      );
      locationIds.push(result.rows[0].id);
    }
    logger.info(`Created ${locationIds.length} locations`);

    // Create sample ride requests
    const rideRequests = [
      {
        user_id: userIds[0],
        pickup_location_id: locationIds[0], // JFK Airport
        dropoff_location_id: locationIds[1], // Manhattan Downtown
        pickup_latitude: 40.6413,
        pickup_longitude: -73.7781,
        dropoff_latitude: 40.7589,
        dropoff_longitude: -73.9851,
        passenger_count: 1,
        luggage_count: 2,
      },
      {
        user_id: userIds[1],
        pickup_location_id: locationIds[0], // JFK Airport
        dropoff_location_id: locationIds[4], // Times Square
        pickup_latitude: 40.6420,
        pickup_longitude: -73.7785,
        dropoff_latitude: 40.7580,
        dropoff_longitude: -73.9855,
        passenger_count: 2,
        luggage_count: 1,
      },
      {
        user_id: userIds[2],
        pickup_location_id: locationIds[0], // JFK Airport
        dropoff_location_id: locationIds[2], // Brooklyn Heights
        pickup_latitude: 40.6415,
        pickup_longitude: -73.7780,
        dropoff_latitude: 40.6962,
        dropoff_longitude: -73.9942,
        passenger_count: 1,
        luggage_count: 1,
      },
      {
        user_id: userIds[3],
        pickup_location_id: locationIds[6], // LaGuardia Airport
        dropoff_location_id: locationIds[1], // Manhattan Downtown
        pickup_latitude: 40.7769,
        pickup_longitude: -73.8740,
        dropoff_latitude: 40.7589,
        dropoff_longitude: -73.9851,
        passenger_count: 1,
        luggage_count: 2,
      },
      {
        user_id: userIds[4],
        pickup_location_id: locationIds[6], // LaGuardia Airport
        dropoff_location_id: locationIds[5], // Central Park
        pickup_latitude: 40.7770,
        pickup_longitude: -73.8742,
        dropoff_latitude: 40.7829,
        dropoff_longitude: -73.9654,
        passenger_count: 2,
        luggage_count: 3,
      },
    ];

    for (const ride of rideRequests) {
      await db.query(
        `INSERT INTO ride_requests 
         (user_id, pickup_location_id, dropoff_location_id, 
          pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
          passenger_count, luggage_count, max_detour_km, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5.0, 'pending')`,
        [
          ride.user_id,
          ride.pickup_location_id,
          ride.dropoff_location_id,
          ride.pickup_latitude,
          ride.pickup_longitude,
          ride.dropoff_latitude,
          ride.dropoff_longitude,
          ride.passenger_count,
          ride.luggage_count,
        ]
      );
    }
    logger.info(`Created ${rideRequests.length} ride requests`);

    logger.info('Database seeding completed successfully');

    // Print summary
    console.log('\n=== SEED DATA SUMMARY ===');
    console.log(`Users created: ${userIds.length}`);
    console.log(`Locations created: ${locationIds.length}`);
    console.log(`Ride requests created: ${rideRequests.length}`);
    console.log('\nSample User Credentials:');
    users.slice(0, 3).forEach((user, idx) => {
      console.log(`  ${user.name}: ${user.email} (ID: ${userIds[idx]})`);
    });
    console.log('\n=========================\n');
  } catch (error) {
    logger.error('Database seeding failed:', error);
    throw error;
  }
}

if (require.main === module) {
  seed()
    .then(() => {
      logger.info('Seed script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Seed script failed:', error);
      process.exit(1);
    });
}

export { seed };
