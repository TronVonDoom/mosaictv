import { PrismaClient } from '@prisma/client'

// Local-dev fallback. In Docker/production DATABASE_URL is always set (compose +
// Dockerfile ENV), so this only kicks in when running the app directly.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db'
}

// Single shared Prisma client for the whole app.
export const prisma = new PrismaClient()
