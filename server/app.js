import { randomUUID } from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { config } from './config.js'
import { verifyDatabaseConnection } from './db.js'
import { errorHandler, HttpError } from './http.js'
import authRoutes from './routes/auth.js'
import attendanceRoutes from './routes/attendance.js'
import studentRoutes from './routes/students.js'
import classRoutes from './routes/classes.js'
import reportRoutes from './routes/reports.js'
import notificationRoutes from './routes/notifications.js'
import schoolRoutes from './routes/schools.js'
import teacherRoutes from './routes/teachers.js'
import userRoutes from './routes/users.js'
import parentRoutes from './routes/parents.js'
import auditRoutes from './routes/audit.js'
import deviceRoutes from './routes/devices.js'

export function createApp({ disableRateLimit = false } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false)
  app.use((request, response, next) => {
    request.requestId = randomUUID()
    response.setHeader('X-Request-Id', request.requestId)
    next()
  })
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.appOrigins.includes(origin)) return callback(null, true)
      callback(new HttpError(403, 'Origin is not permitted.', 'cors_origin_denied'))
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
  }))
  app.use(express.json({ limit: '128kb', strict: true }))
  app.use(cookieParser())
  app.use((request, _response, next) => {
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)
    const origin = request.get('Origin')
    if (isMutation && origin && !config.appOrigins.includes(origin)) return next(new HttpError(403, 'Origin is not permitted.', 'origin_denied'))
    next()
  })
  if (!disableRateLimit) app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }))

  app.get('/api/health', async (_request, response) => {
    try {
      await verifyDatabaseConnection()
      response.json({ status: 'ok', database: 'connected', environment: config.nodeEnv })
    } catch {
      response.status(503).json({ status: 'degraded', database: 'unavailable' })
    }
  })
  app.use('/api/auth', authRoutes)
  app.use('/api/attendance', attendanceRoutes)
  app.use('/api/students', studentRoutes)
  app.use('/api/classes', classRoutes)
  app.use('/api/reports', reportRoutes)
  app.use('/api/notifications', notificationRoutes)
  app.use('/api/schools', schoolRoutes)
  app.use('/api/teachers', teacherRoutes)
  app.use('/api/users', userRoutes)
  app.use('/api/parents', parentRoutes)
  app.use('/api/audit', auditRoutes)
  app.use('/api/devices', deviceRoutes)
  app.use('/api', (_request, _response, next) => next(new HttpError(404, 'API route not found.', 'route_not_found')))
  app.use(errorHandler)
  return app
}
