import { Router, Request, Response } from 'express';
import { rideService } from '../services/rideService';
import { pricingService } from '../services/pricingService';
import { validateUUID } from '../middleware/validation';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler';

const router = Router();

/**
 * GET /api/pricing/:rideRequestId
 * Get pricing for a ride request
 */
router.get(
  '/:rideRequestId',
  validateUUID('rideRequestId'),
  asyncHandler(async (req: Request, res: Response) => {
    const { rideRequestId } = req.params;

    const rideRequest = await rideService.getRideRequest(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }

    // Get pricing history
    const history = await pricingService.getPricingHistory(rideRequestId);

    // Calculate current price
    const currentPrice = await pricingService.calculatePrice(rideRequest, false, 1);

    res.json({
      success: true,
      data: {
        ride_request_id: rideRequestId,
        current_pricing: currentPrice,
        pricing_history: history,
      },
    });
  })
);

/**
 * POST /api/pricing/calculate
 * Calculate pricing for hypothetical ride (before creating request)
 */
router.post(
  '/calculate',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      pickup_latitude,
      pickup_longitude,
      dropoff_latitude,
      dropoff_longitude,
      passenger_count,
      luggage_count,
    } = req.body;

    // Create temporary ride object for calculation
    const tempRide: any = {
      pickup_latitude,
      pickup_longitude,
      dropoff_latitude,
      dropoff_longitude,
      passenger_count: passenger_count || 1,
      luggage_count: luggage_count || 0,
      max_detour_km: 5,
    };

    const soloPrice = await pricingService.calculatePrice(tempRide, false, 1);
    const pooledPrice = await pricingService.calculatePrice(tempRide, true, 2);

    res.json({
      success: true,
      data: {
        solo_ride: soloPrice,
        pooled_ride: pooledPrice,
        savings: soloPrice.final_price - pooledPrice.final_price,
        savings_percent: (
          ((soloPrice.final_price - pooledPrice.final_price) / soloPrice.final_price) *
          100
        ).toFixed(2),
      },
    });
  })
);

export default router;
