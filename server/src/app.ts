import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { config } from './config'
import { getDb } from './db/database'
import { errorHandler } from './middleware/errorHandler'
import { traceIdMiddleware } from './middleware/traceId'
import authRoutes from './routes/auth'
import boardRoutes from './routes/boards'
import wordBankRoutes from './routes/wordbank'
import uploadRoutes from './routes/upload'
import illustrationRoutes from './routes/illustrations'
import templateRoutes from './routes/templates'
import moderationRoutes from './routes/moderation'
import feedbackRoutes from './routes/feedback'
import adminRoutes from './routes/admin'

export function createApp() {
  const app = express()

  // Trust X-Forwarded-For behind Nginx so rate-limit uses real IP
  if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1)
  }

  // ---------- Security middleware ----------
  // Allow admin page to load CDN images
  const cdnDomain = config.storage.oss.cdnDomain
  const imgSrc = ["'self'", 'data:', 'blob:']
  if (cdnDomain) imgSrc.push(`https://${cdnDomain}`)

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': imgSrc,
      },
    },
  }))

  // Request tracing
  app.use(traceIdMiddleware)

  // Request logging (with traceId)
  morgan.token('trace-id', (req) => (req as express.Request).traceId || '-')
  if (config.nodeEnv === 'production') {
    // Production: JSON format for grep/jq
    app.use(morgan((tokens, req, res) => JSON.stringify({
      time: tokens.date(req, res, 'iso'),
      method: tokens.method(req, res),
      url: tokens.url(req, res),
      status: Number(tokens.status(req, res)),
      ms: Number(tokens['response-time'](req, res)),
      size: tokens.res(req, res, 'content-length') || '0',
      traceId: tokens['trace-id'](req, res),
    })))
  } else if (config.nodeEnv !== 'test') {
    // Dev: human-readable format
    app.use(morgan(':method :url :status :response-time ms [:trace-id]'))
  }

  app.use(cors({
    origin: config.nodeEnv === 'production'
      ? ['https://servicewechat.com']
      : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }))

  // Global rate limit: 120 req/min per IP (skipped in test)
  if (config.nodeEnv !== 'test') {
    app.use(rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: '请求过于频繁，请稍后再试' },
    }))
  }

  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: true, limit: '100kb' }))

  // Static files: uploaded images
  app.use('/uploads', express.static(config.uploadDir))

  // ---------- Rate limits for sensitive endpoints (skipped in test) ----------
  if (config.nodeEnv !== 'test') {
    const loginLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: '登录请求过于频繁，请稍后再试' },
    })
    const adminLoginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: '管理员登录请求过于频繁，请 15 分钟后再试' },
    })
    const uploadLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: '上传过于频繁，请稍后再试' },
    })
    const feedbackLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: '反馈提交过于频繁，请稍后再试' },
    })
    const moderationLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: '审核请求过于频繁，请稍后再试' },
    })
    app.use('/api/auth/login', loginLimiter)
    app.use('/api/auth/refresh', loginLimiter)
    app.use('/api/admin/login', adminLoginLimiter)
    app.use('/api/upload', uploadLimiter)
    app.post('/api/feedback', feedbackLimiter)
    app.use('/api/moderation', moderationLimiter)
  }

  // ---------- Routes ----------
  app.use('/api/auth', authRoutes)
  app.use('/api/boards', boardRoutes)
  app.use('/api/wordbank', wordBankRoutes)
  app.use('/api/upload', uploadRoutes)
  app.use('/api/illustrations', illustrationRoutes)
  app.use('/api/templates', templateRoutes)
  app.use('/api/moderation', moderationRoutes)
  app.use('/api/feedback', feedbackRoutes)
  app.use('/api/admin', adminRoutes)

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } })
  })

  // ---------- Error handling ----------
  app.use(errorHandler)

  // Initialize database
  getDb()

  return app
}
