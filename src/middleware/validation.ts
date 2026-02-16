import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';

export const validateCreateRideRequest = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const schema = Joi.object({
    user_id: Joi.string().uuid().required(),
    pickup_location_id: Joi.string().uuid().required(),
    dropoff_location_id: Joi.string().uuid().required(),
    pickup_latitude: Joi.number().min(-90).max(90).required(),
    pickup_longitude: Joi.number().min(-180).max(180).required(),
    dropoff_latitude: Joi.number().min(-90).max(90).required(),
    dropoff_longitude: Joi.number().min(-180).max(180).required(),
    passenger_count: Joi.number().integer().min(1).max(4).required(),
    luggage_count: Joi.number().integer().min(0).max(4).required(),
    max_detour_km: Joi.number().min(0).max(20).optional(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: error.details.map((d) => d.message),
    });
  }

  next();
};

export const validateUUID = (paramName: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const schema = Joi.string().uuid().required();
    const { error } = schema.validate(req.params[paramName]);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${paramName}`,
      });
    }

    next();
  };
};

export const validatePagination = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).optional().default(1),
    limit: Joi.number().integer().min(1).max(100).optional().default(10),
  });

  const { error, value } = schema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid pagination parameters',
    });
  }

  req.query = value;
  next();
};
