import type { NextFunction, Request, RequestHandler, Response } from 'express'

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>
const pending = new Set<Promise<void>>()

/** Track handler completion independently of the client's socket lifetime. */
export function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    const work = Promise.resolve().then(() => handler(req, res, next))
    pending.add(work)
    // Return the rejection to Express 5's normal error handling.
    return work.finally(() => { pending.delete(work) })
  }
}

export async function drainAsyncRoutes(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending])
  }
}
