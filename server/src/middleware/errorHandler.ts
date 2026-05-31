import { Request, Response, NextFunction } from 'express'
import { logger } from '../services/logger'

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const traceId = req.traceId || '-'
  const context = {
    traceId,
    method: req.method,
    url: req.originalUrl,
    userId: (req as any).user?.userId,
  }

  logger.error(err.message, {
    ...context,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  })

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? '服务器内部错误'
      : err.message,
    traceId,
  })
}
