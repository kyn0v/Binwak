/**
 * App channel middleware
 *
 * Reads the X-App-Channel request header and attaches it to req.appChannel.
 * Supported values: 'stable' (default) | 'beta'
 *
 * This allows the shared backend to serve different behaviour for the
 * production mini-program ('stable') and the test/preview build ('beta')
 * without any code changes on a per-request basis.
 */
import { Request, Response, NextFunction } from 'express'

export type AppChannel = 'stable' | 'beta'

declare global {
  namespace Express {
    interface Request {
      appChannel: AppChannel
    }
  }
}

export function channelMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers['x-app-channel']
  req.appChannel = header === 'beta' ? 'beta' : 'stable'
  next()
}
