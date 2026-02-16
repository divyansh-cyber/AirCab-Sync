import { Router, Request, Response } from 'express';
import { rideService } from '../services/rideService';
import { pricingService } from '../services/pricingService';
import { validateCreateRideRequest, validateUUID } from '../middleware/validation';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler';
import { logger } from '../logger';

const router = Router();

/**
 * POST /api/rides/request
 * Create a new ride request
 */
router.post(
  '/request',
  validateCreateRideRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();

    const rideRequest = await rideService.createRideRequest(req.body);

    // Calculate initial pricing
    const pricing = await pricingService.calculatePrice(rideRequest, false, 1);

    const responseTime = Date.now() - startTime;
    logger.info('Ride request created', {
      rideRequestId: rideRequest.id,
      responseTime,
    });

    res.status(201).json({
      success: true,
      data: {
        ride_request: rideRequest,
        pricing,
      },
      meta: {
        response_time_ms: responseTime,
      },
    });
  })
);

/**
 * GET /api/rides/:id
 * Get ride request details
 */
router.get(
  '/:id',
  validateUUID('id'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const rideWithPricing = await rideService.getRideWithPricing(id);

    if (!rideWithPricing) {
      throw new NotFoundError('Ride request not found');
    }

    res.json({
      success: true,
      data: rideWithPricing,
    });
  })
);

/**
 * POST /api/rides/:id/cancel
 * Cancel a ride request
 */
router.post(
  '/:id/cancel',
  validateUUID('id'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const cancelledRide = await rideService.cancelRideRequest(id);

    logger.info('Ride cancelled', { rideRequestId: id });

    res.json({
      success: true,
      data: cancelledRide,
      message: 'Ride request cancelled successfully',
    });
  })
);

/**
 * GET /api/rides/user/:userId
 * Get all rides for a user
 */
router.get(
  '/user/:userId',
  validateUUID('userId'),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const rides = await rideService.getRidesByUser(userId);

    res.json({
      success: true,
      data: rides,
      meta: {
        count: rides.length,
      },
    });
  })
);

/**
 * GET /api/rides/pending
 * Get all pending ride requests (admin)
 */
router.get(
  '/pending',
  asyncHandler(async (req: Request, res: Response) => {
    const rides = await rideService.getPendingRides();

    res.json({
      success: true,
      data: rides,
      meta: {
        count: rides.length,
      },
    });
  })
);

export default router;
