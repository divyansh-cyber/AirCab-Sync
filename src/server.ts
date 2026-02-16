import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { db } from './database/db';
import { redis } from './database/redis';
import { errorHandler } from './middleware/errorHandler';

// Import routes
import ridesRouter from './routes/rides';
import poolsRouter from './routes/pools';
import pricingRouter from './routes/pricing';

/**
 * EXPRESS SERVER WITH PRODUCTION-READY MIDDLEWARE
 * 
 * CONCURRENCY HANDLING:
 * - Node.js event loop handles concurrent requests efficiently
 * - Database connection pooling (max 20 connections)
 * - Redis for caching and rate limiting
 * - Rate limiting: 100 requests per minute per IP
 * - Helmet for security headers
 * - CORS enabled for cross-origin requests
 * - Compression for response optimization
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * - Response compression
 * - Database query result caching
 * - Connection pooling
 * - Async/await for non-blocking operations
 * - Indexed database queries
 */

export class Server {
  private app: Application;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet());

    // CORS
    this.app.use(
      cors({
        origin: '*', // Configure for production
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      })
    );

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Compression
    this.app.use(compression());

    // Logging
    this.app.use(
      morgan('combined', {
        stream: { write: (message) => logger.info(message.trim()) },
      })
    );

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.rateLimiting.windowMs,
      max: config.rateLimiting.maxRequests,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // Request tracking
    this.app.use((req, _res, next) => {
      req.headers['x-request-id'] = req.headers['x-request-id'] || 
        `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async (req: Request, res: Response) => {
      try {
        const dbHealth = await db.healthCheck();
        const redisHealth = await redis.healthCheck();

        const health = {
          status: dbHealth && redisHealth ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          database: dbHealth ? 'connected' : 'disconnected',
          redis: redisHealth ? 'connected' : 'disconnected',
          memory: process.memoryUsage(),
        };

        res.status(dbHealth && redisHealth ? 200 : 503).json(health);
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: 'Health check failed',
        });
      }
    });

    // API documentation
    try {
      const swaggerDocument = YAML.load(path.join(__dirname, '../swagger.yaml'));
      this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    } catch (error) {
      logger.warn('Swagger documentation not available');
    }

    // API routes
    this.app.use('/api/rides', ridesRouter);
    this.app.use('/api/pools', poolsRouter);
    this.app.use('/api/pricing', pricingRouter);

    // Root route
    this.app.get('/', (_req: Request, res: Response) => {
      res.json({
        service: 'Airport Ride Pooling API',
        version: '1.0.0',
        status: 'running',
        documentation: '/api-docs',
        health: '/health',
      });
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', { promise, reason });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.shutdown('UNCAUGHT_EXCEPTION');
    });
  }

  public async start(): Promise<void> {
    try {
      // Connect to Redis
      await redis.connect();
      logger.info('Redis connected');

      // Test database connection
      const dbConnected = await db.healthCheck();
      if (!dbConnected) {
        throw new Error('Database connection failed');
      }
      logger.info('Database connected');

      // Start server
      this.app.listen(config.port, config.host, () => {
        logger.info(`Server running on ${config.host}:${config.port}`);
        logger.info(`Environment: ${config.env}`);
        logger.info(`API Documentation: http://${config.host}:${config.port}/api-docs`);
      });
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  private async shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    try {
      // Close database connections
      await db.close();
      logger.info('Database connections closed');

      // Close Redis connection
      await redis.close();
      logger.info('Redis connection closed');

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  public getApp(): Application {
    return this.app;
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new Server();
  server.start();
}

export default Server;
