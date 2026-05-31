/**
 * Trace ID middleware
 *
 * Reads X-Trace-Id from the request header (client-generated) or creates one.
 * Attaches it to req.traceId and echoes it back in the response header.
 *
 * Usage: grep server logs by traceId to find all entries for a single request.
 */
import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'

declare global {
  namespace Express {
    interface Request {
      traceId: string
    }
  }
}

/** 8-char hex string — short enough for users to copy, unique enough for our scale */
function generateTraceId(): string {
  return crypto.randomBytes(4).toString('hex')
}

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientTraceId = req.headers['x-trace-id'] as string | undefined
  const traceId = clientTraceId && /^[a-f0-9]{6,32}$/i.test(clientTraceId)
    ? clientTraceId
    : generateTraceId()

  req.traceId = traceId
  res.setHeader('X-Trace-Id', traceId)
  next()
}
