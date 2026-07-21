import { Router } from 'express'
import { getMetrics } from '../metrics.js'

export const metricsRouter = Router()

// GET /api/metrics?minutes=15 — resource samples plus the playout transitions
// that landed on the same timeline.
metricsRouter.get('/', (req, res) => {
  const minutes = req.query.minutes != null ? Number(req.query.minutes) : undefined
  res.json(getMetrics(Number.isFinite(minutes as number) ? minutes : undefined))
})
