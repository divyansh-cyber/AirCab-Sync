import { Router, Request, Response } from 'express';
import { poolService } from '../services/poolService';
import { validateUUID } from '../middleware/validation';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler';
import { logger } from '../logger';

const router = Router();

/**
 * GET /api/pools/:id
 * Get pool details with members
 */
router.get(
  '/:id',
  validateUUID('id'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const poolWithMembers = await poolService.getPoolWithMembers(id);

    if (!poolWithMembers) {
      throw new NotFoundError('Pool not found');
    }

    res.json({
      success: true,
      data: poolWithMembers,
    });
  })
);

/**
 * GET /api/pools
 * Get all active pools
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const pools = await poolService.getActivePools();

    res.json({
      success: true,
      data: pools,
      meta: {
        count: pools.length,
      },
    });
  })
);

/**
 * POST /api/pools/:poolId/members/:rideRequestId
 * Add member to pool (manual matching)
 */
router.post(
  '/:poolId/members/:rideRequestId',
  validateUUID('poolId'),
  validateUUID('rideRequestId'),
  asyncHandler(async (req: Request, res: Response) => {
    const { poolId, rideRequestId } = req.params;

    await poolService.addMemberToPool(poolId, rideRequestId);

    logger.info('Member manually added to pool', { poolId, rideRequestId });

    res.json({
      success: true,
      message: 'Member added to pool successfully',
    });
  })
);

/**
 * DELETE /api/pools/:poolId/members/:rideRequestId
 * Remove member from pool
 */
router.delete(
  '/:poolId/members/:rideRequestId',
  validateUUID('poolId'),
  validateUUID('rideRequestId'),
  asyncHandler(async (req: Request, res: Response) => {
    const { poolId, rideRequestId } = req.params;

    await poolService.removeMemberFromPool(poolId, rideRequestId);

    logger.info('Member removed from pool', { poolId, rideRequestId });

    res.json({
      success: true,
      message: 'Member removed from pool successfully',
    });
  })
);

/**
 * PATCH /api/pools/:id/status
 * Update pool status
 */
router.patch(
  '/:id/status',
  validateUUID('id'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['forming', 'confirmed', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
      });
    }

    const updatedPool = await poolService.updatePoolStatus(id, status);

    res.json({
      success: true,
      data: updatedPool,
    });
  })
);

export default router;
