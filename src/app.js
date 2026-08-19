import path from 'node:path'
import express from 'express'
import cors from 'cors'
import { buildCorsOrigin } from './lib/cors-origin.js'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { userRoutes } from './modules/users/user.routes.js'
import { zoneRoutes } from './modules/zones/zone.routes.js'
import { buildingRoutes } from './modules/buildings/building.routes.js'
import { uploadRoutes } from './modules/uploads/upload.routes.js'
import { buildingTypeRoutes } from './modules/building-types/building-type.routes.js'
import { statsRoutes } from './modules/stats/stats.routes.js'
import { systemLogRoutes } from './modules/system-logs/system-log.routes.js'
import { operatorRoutes } from './modules/operators/operator.routes.js'
import { cityRoutes } from './modules/cities/city.routes.js'
import { fiberRouteRoutes } from './modules/fiber-routes/fiber-route.routes.js'

export function createApp() {
  const app = express()

  // Behind a load balancer / reverse proxy in production (correct client IPs,
  // https detection).
  if (env.nodeEnv === 'production') app.set('trust proxy', 1)

  // Restrict which browser origins may call the API. '*' in dev; a specific
  // list in production (CORS_ORIGIN, wildcards allowed for Vercel previews).
  // We authenticate via bearer tokens, not cookies, so credentials stay off.
  app.use(cors({ origin: buildCorsOrigin(env.corsOrigin) }))
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/v1/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok' } })
  })

  app.use('/api/v1/auth', authRoutes)
  app.use('/api/v1/users', userRoutes)
  app.use('/api/v1/zones', zoneRoutes)
  app.use('/api/v1/buildings', buildingRoutes)
  // Uploads are user-supplied: block MIME sniffing and script execution so a
  // crafted file can never run in the app's origin (images still render inline).
  app.use(
    '/uploads',
    express.static(path.resolve(env.uploadsDir), {
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
      },
    }),
  )
  app.use('/api/v1/uploads', uploadRoutes)
  app.use('/api/v1/building-types', buildingTypeRoutes)
  app.use('/api/v1/stats', statsRoutes)
  app.use('/api/v1/system-logs', systemLogRoutes)
  app.use('/api/v1/operators', operatorRoutes)
  app.use('/api/v1/cities', cityRoutes)
  app.use('/api/v1/fiber-routes', fiberRouteRoutes)

  app.use(errorHandler)
  return app
}
