import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@ip-centrum/shared';

const logger = createLogger('api-server');

export const errorHandler = (
  err: Error & { status?: number; code?: string },
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  logger.error('Unhandled error', {
    data: {
      status,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      path: req.path,
      method: req.method,
    },
  });

  res.status(status).json({
    error: message,
    code: err.code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const correlationId = req.headers['x-correlation-id'] as string || crypto.randomUUID();

  res.on('finish', () => {
    logger.info(`${req.method} ${req.path}`, {
      correlationId,
      data: {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        userId: req.user?.id,
      },
    });
  });

  next();
};
