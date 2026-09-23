// Express 4 predates async handlers: when one throws, the rejected promise
// never reaches Express's error path. Node then treats it as an unhandled
// rejection — which since Node 15 terminates the process — so a single bad
// request (a malformed id Prisma refuses, say) could restart the container
// and cut every viewer off mid-stream.
//
// This wraps every registered route handler so a rejection is passed to
// `next(err)`, where `apiErrorHandler` logs it and answers 500. It's applied
// once at boot, after the routes are declared, so the route files stay plain.

import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express'
import { log } from './logs.js'

type Handler = ((req: Request, res: Response, next: NextFunction) => unknown) & { length: number }
type Layer = { route?: { stack: { handle: Handler }[] }; name?: string; handle: Handler & { stack?: Layer[] } }

function wrap(fn: Handler): Handler {
  // Error middleware is recognised by arity; leave it exactly as it is.
  if (fn.length === 4) return fn
  return function wrapped(req: Request, res: Response, next: NextFunction) {
    try {
      const out = fn(req, res, next) as { then?: unknown; catch?: (cb: (e: unknown) => void) => unknown } | undefined
      if (out && typeof out.then === 'function' && typeof out.catch === 'function') out.catch(next)
    } catch (e) {
      next(e)
    }
  } as Handler
}

/** Wrap every route handler in `stack`, descending into mounted routers. */
export function catchAsyncErrors(stack: Layer[] | undefined): void {
  for (const layer of stack ?? []) {
    if (layer.route) {
      for (const l of layer.route.stack) l.handle = wrap(l.handle)
    } else if (layer.name === 'router' && layer.handle.stack) {
      catchAsyncErrors(layer.handle.stack)
    }
  }
}

/** The last middleware: log the failure and answer rather than hang. */
export const apiErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  log('error', 'system', `Request failed: ${req.method} ${req.originalUrl}`, String((err as Error)?.stack || err))
  if (res.headersSent) {
    res.end()
    return
  }
  res.status(500).json({ error: 'The server hit an error handling that request — see Logs for details.' })
}
