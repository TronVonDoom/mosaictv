import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { concatPlaylist, streamChannelItem } from '../streaming/channel.js'
import { log } from '../logs.js'

export const internalRouter = Router()

// These endpoints exist only for the channel's own outer ffmpeg to call back
// into over loopback. They're on the same listener as everything else, so gate
// them: nothing outside this container has any business fetching a raw item.
function localOnly(req: Request, res: Response, next: NextFunction) {
  const ip = req.socket.remoteAddress ?? ''
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  if (!local) return res.status(403).end()
  next()
}

internalRouter.use(localOnly)

// The ffconcat playlist the outer process loops over.
internalRouter.get('/concat/:number', (req, res) => {
  res.setHeader('Content-Type', 'text/plain')
  res.setHeader('Cache-Control', 'no-cache, no-store')
  res.send(concatPlaylist(Number(req.params.number)))
})

// One item — whatever is on air right now — encoded and streamed until it ends.
internalRouter.get('/stream/:number', (req, res) => {
  streamChannelItem(Number(req.params.number), res, req).catch((e) => {
    log('error', 'stream', `Item stream for channel ${req.params.number} threw`, String(e?.stack || e))
    // Always close the response: a hanging item would make the outer ffmpeg
    // wait on it forever, and the viewer sees an endless spinner.
    if (!res.headersSent) res.status(500).end()
    else if (!res.writableEnded) res.end()
  })
})
