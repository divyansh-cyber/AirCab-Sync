# Architecture & Design Documentation

## System Architecture

### 1. High-Level Architecture

The system follows a layered architecture pattern with clear separation of concerns:

```
┌────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                          │
│              (Mobile Apps, Web Browsers)                   │
└───────────────────────┬────────────────────────────────────┘
                        │ HTTPS / REST API
                        ▼
┌────────────────────────────────────────────────────────────┐
│                   API GATEWAY LAYER                        │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Express.js Server                                    │ │
│  │ - Rate Limiting (100 req/min)                        │ │
│  │ - Authentication & Authorization                     │ │
│  │ - Request Validation (Joi)                           │ │
│  │ - Security (Helmet, CORS)                            │ │
│  │ - Response Compression                               │ │
│  │ - Logging (Winston)                                  │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────┬────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│    Rides     │ │    Pools     │ │   Pricing    │
│   Router     │ │   Router     │ │   Router     │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
┌───────────────────────▼────────────────────────────────────┐
│                   SERVICE LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ RideService  │  │ PoolService  │  │PricingService│    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │         MatchingEngine (Core Algorithm)          │    │
│  │  - Constraint satisfaction                       │    │
│  │  - Route optimization                            │    │
│  │  - Greedy matching algorithm                     │    │
│  └──────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │    Redis     │  │   Metrics    │
│   Database   │  │    Cache     │  │   Storage    │
│              │  │              │  │              │
│ - ACID       │  │ - Session    │  │ - Analytics  │
│ - Indexes    │  │ - Cache      │  │ - Monitoring │
│ - Pooling    │  │ - RateLimit  │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 2. Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Express Server                          │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Middleware Stack                         │ │
│  │  - Helmet (Security Headers)                          │ │
│  │  - CORS (Cross-Origin Resource Sharing)              │ │
│  │  - Morgan (HTTP Request Logging)                     │ │
│  │  - Compression (Response Compression)                 │ │
│  │  - Rate Limiter (DDoS Protection)                     │ │
│  │  - Body Parser (JSON/URL Encoding)                   │ │
│  │  - Error Handler (Centralized Error Handling)        │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                 Route Controllers                     │ │
│  │                                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │ │
│  │  │ Rides Router │  │ Pools Router │  │ Pricing    │ │ │
│  │  │              │  │              │  │ Router     │ │ │
│  │  │ - POST /req  │  │ - GET /:id   │  │ - GET /:id │ │ │
│  │  │ - GET /:id   │  │ - POST /add  │  │ - POST /cal│ │ │
│  │  │ - POST /can  │  │ - DELETE /rm │  │            │ │ │
│  │  │ - GET /user  │  │ - PATCH /st  │  │            │ │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                  Business Logic                       │ │
│  │                                                       │ │
│  │  ┌──────────────────────────────────────────────┐   │ │
│  │  │          MatchingEngine                      │   │ │
│  │  │  ┌────────────────────────────────────────┐  │   │ │
│  │  │  │ findBestMatch()                        │  │   │ │
│  │  │  │ - Check capacity constraints O(1)      │  │   │ │
│  │  │  │ - Check location compatibility O(k)    │  │   │ │
│  │  │  │ - Analyze route O(k²)                  │  │   │ │
│  │  │  │ - Calculate score O(1)                 │  │   │ │
│  │  │  │ - Sort and select O(m log m)           │  │   │ │
│  │  │  └────────────────────────────────────────┘  │   │ │
│  │  └──────────────────────────────────────────────┘   │ │
│  │                                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │ │
│  │  │ RideService  │  │ PoolService  │  │ Pricing    │ │ │
│  │  │              │  │              │  │ Service    │ │ │
│  │  │ - createRide │  │ - createPool │  │ - calc$    │ │ │
│  │  │ - getRide    │  │ - addMember  │  │ - getDemand│ │ │
│  │  │ - cancelRide │  │ - removeMbr  │  │ - savePrc  │ │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Data Access Layer                        │ │
│  │                                                       │ │
│  │  ┌──────────────┐              ┌──────────────┐     │ │
│  │  │   Database   │              │    Redis     │     │ │
│  │  │   Manager    │              │   Manager    │     │ │
│  │  │              │              │              │     │ │
│  │  │ - query()    │              │ - get()      │     │ │
│  │  │ - transaction│              │ - set()      │     │ │
│  │  │ - healthCheck│              │ - del()      │     │ │
│  │  └──────────────┘              └──────────────┘     │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Design Patterns

### 1. Singleton Pattern
**Used in**: Database and Redis connections
```typescript
class Database {
  private static instance: Database;
  
  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }
}
```

**Benefits**:
- Single connection pool shared across application
- Prevents resource exhaustion
- Thread-safe (in Node.js single-threaded context)

### 2. Factory Pattern
**Used in**: Pool creation
```typescript
class PoolService {
  async createPool(requests: RideRequest[]): Promise<RidePool> {
    // Factory method creates pool based on requests
    const poolCode = this.generatePoolCode();
    // ... create and configure pool
  }
}
```

**Benefits**:
- Encapsulates pool creation logic
- Allows different pool types in future
- Centralized configuration

### 3. Strategy Pattern
**Used in**: Pricing calculations
```typescript
interface PricingStrategy {
  calculate(ride: RideRequest, poolSize: number): PriceBreakdown;
}

class DynamicPricingStrategy implements PricingStrategy {
  calculate(ride, poolSize) {
    // Dynamic pricing logic
  }
}
```

**Benefits**:
- Easily swap pricing algorithms
- Add new pricing strategies without modifying existing code
- Testable in isolation

### 4. Repository Pattern
**Used in**: Data access layer
```typescript
class RideRepository {
  async findById(id: string): Promise<RideRequest | null> {
    // Abstract database access
  }
}
```

**Benefits**:
- Separation of business logic from data access
- Easy to mock for testing
- Can swap database implementations

### 5. Middleware Pattern
**Used in**: Express middleware chain
```typescript
app.use(helmet());
app.use(cors());
app.use(rateLimit());
app.use(validateRequest);
```

**Benefits**:
- Modular request processing
- Easy to add/remove functionality
- Reusable across routes

## Concurrency Handling Strategy

### 1. Database Level

#### Connection Pooling
```typescript
const pool = new Pool({
  min: 2,      // Minimum connections
  max: 20,     // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

**Handling 10,000 concurrent users**:
- Connection pool efficiently manages database connections
- Queues requests when pool is full
- Prevents database overload

#### Transaction Isolation
```typescript
await db.transaction(async (client) => {
  await client.query('BEGIN');
  // Multiple operations
  await client.query('COMMIT');
});
```

**Benefits**:
- ACID compliance
- Prevents race conditions
- Rollback on errors

#### Row-Level Locking
```sql
SELECT * FROM ride_requests 
WHERE id = $1 
FOR UPDATE;
```

**Prevents**:
- Concurrent cancellations
- Double booking
- Inconsistent pool capacity

### 2. Application Level

#### Async/Await Pattern
```typescript
async function createRide(data) {
  const ride = await saveToDatabase(data);
  await triggerMatchingAsync(ride);  // Non-blocking
  return ride;
}
```

**Benefits**:
- Non-blocking I/O
- Efficient event loop utilization
- Handles concurrent requests

#### Redis Caching
```typescript
// Check cache first
const cached = await redis.get(key);
if (cached) return JSON.parse(cached);

// Fetch from database
const data = await db.query();
await redis.set(key, JSON.stringify(data), TTL);
```

**Benefits**:
- Reduces database load
- Improves response time
- Handles read-heavy workloads

#### Rate Limiting
```typescript
const limiter = rateLimit({
  windowMs: 60000,  // 1 minute
  max: 100,         // 100 requests per window
});
```

**Benefits**:
- Prevents DDoS attacks
- Fair resource allocation
- System stability

### 3. Performance Optimizations

#### Indexing Strategy
```sql
-- Compound index for common query pattern
CREATE INDEX idx_ride_requests_status_requested_at 
ON ride_requests(status, requested_at DESC);

-- Geospatial index for location queries
CREATE INDEX idx_ride_requests_pickup_coords 
ON ride_requests(pickup_latitude, pickup_longitude);
```

**Query Performance**:
- Before indexing: O(n) full table scan
- After indexing: O(log n) B-tree lookup

#### Query Optimization
```typescript
// Bad: N+1 query problem
for (const member of members) {
  const ride = await getRide(member.ride_id);  // N queries
}

// Good: Single query with JOIN
const ridesWithMembers = await db.query(`
  SELECT pm.*, rr.*
  FROM pool_members pm
  JOIN ride_requests rr ON pm.ride_request_id = rr.id
  WHERE pm.pool_id = $1
`);
```

### 4. Scalability Considerations

#### Horizontal Scaling
```
┌─────────┐    ┌─────────┐    ┌─────────┐
│  API 1  │    │  API 2  │    │  API 3  │
└────┬────┘    └────┬────┘    └────┬────┘
     └──────────────┼──────────────┘
                    │
             ┌──────▼──────┐
             │Load Balancer│
             └─────────────┘
```

**Stateless Design**:
- No session state in API servers
- Session data in Redis
- Can add/remove servers dynamically

#### Database Scaling
```
┌──────────┐
│ Primary  │ ◄──── Writes
│    DB    │
└────┬─────┘
     │ Replication
     ├─────────────┬─────────────┐
     ▼             ▼             ▼
┌─────────┐   ┌─────────┐   ┌─────────┐
│Replica 1│   │Replica 2│   │Replica 3│
└─────────┘   └─────────┘   └─────────┘
     ▲             ▲             ▲
     └─────────────┴─────────────┘
              Reads
```

**Read Scaling**:
- Write to primary
- Read from replicas
- Distributes load

## Security Considerations

### 1. Input Validation
- Joi schema validation on all inputs
- Type checking with TypeScript
- SQL injection prevention via parameterized queries

### 2. Authentication & Authorization
- JWT tokens (ready to implement)
- Role-based access control
- API key authentication for services

### 3. Rate Limiting
- Per-IP rate limiting
- Per-user rate limiting (when authenticated)
- Distributed rate limiting via Redis

### 4. Security Headers
- Helmet.js for security headers
- CORS configuration
- CSP (Content Security Policy)

### 5. Data Protection
- Environment variables for secrets
- No sensitive data in logs
- Database encryption at rest
- SSL/TLS in production

## Monitoring & Observability

### 1. Logging
```typescript
logger.info('Ride created', {
  rideId: ride.id,
  userId: ride.user_id,
  responseTime: Date.now() - startTime,
});
```

### 2. Metrics
- Request count
- Response times
- Error rates
- Database query performance
- Cache hit ratio

### 3. Health Checks
```typescript
GET /health
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "uptime": 3600
}
```

### 4. Alerting (Future)
- High error rate alerts
- Slow query alerts
- Database connection pool exhaustion
- High memory usage
