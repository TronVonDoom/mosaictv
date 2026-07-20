import { Router } from 'express'
import { getLogs, clearLogs, dumpText, type LogLevel, type LogCategory } from '../logs.js'

export const logsRouter = Router()

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
const CATEGORIES: LogCategory[] = ['stream', 'ffmpeg', 'playout', 'system']

// GET /api/logs?level=&category=&sinceId=&limit=
logsRouter.get('/', (req, res) => {
  const level = LEVELS.includes(req.query.level as LogLevel) ? (req.query.level as LogLevel) : undefined
  const category = CATEGORIES.includes(req.query.category as LogCategory)
    ? (req.query.category as LogCategory)
    : undefined
  const sinceId = req.query.sinceId != null ? Number(req.query.sinceId) : undefined
  const limit = req.query.limit != null ? Number(req.query.limit) : undefined
  res.json(getLogs({ level, category, sinceId, limit }))
})

// GET /api/logs/download — plain-text dump for handing off.
logsRouter.get('/download', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="mosaictv-logs-${Date.now()}.txt"`)
  res.send(dumpText())
})

// DELETE /api/logs — clear buffer + on-disk file.
logsRouter.delete('/', (_req, res) => {
  clearLogs()
  res.status(204).end()
})
