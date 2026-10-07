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
import { popRoutes } from './modules/pops/pop.routes.js'
import { salesRoutes } from './modules/sales/sales.routes.js'
import { visitTaskRoutes } from './modules/visit-tasks/visit-task.routes.js'
import { closureRoutes } from './modules/closures/closure.routes.js'
import { splitterRoutes } from './modules/closures/splitter.routes.js'
import { fiberRoutes } from './modules/fibers/fiber.routes.js'
import { appVersionRoutes, appReleaseRoutes } from './modules/app-releases/app-release.routes.js'
import { partnerAuthRoutes } from './modules/partner-auth/partner-auth.routes.js'
import { inviteRoutes } from './modules/partner-invites/invite.routes.js'
import { partnerSelfRoutes, partnerAdminRoutes } from './modules/partners/partner.routes.js'
import { partnerPushTokenRoutes } from './modules/partners/push-token.routes.js'
import { partnerLeadRoutes, staffLeadRoutes } from './modules/leads/lead.routes.js'
import { partnerRateCardRoutes, staffRateCardRoutes } from './modules/rate-card/rate-card.routes.js'
import {
  partnerReferralRoutes,
  staffPartnerReferralRoutes,
} from './modules/partner-referrals/partner-referral.routes.js'
import { payoutRoutes } from './modules/earnings/payout.routes.js'
import { partnerDashboardRoutes } from './modules/partner-dashboard/dashboard.routes.js'

export function createApp() {
  const app = express()

  // Behind a load balancer / reverse proxy in production (correct client IPs,
  // https detection).
  if (env.nodeEnv === 'production') app.set('trust proxy', 1)

  // Restrict which browser origins may call the API. '*' in dev; a specific
  // list in production (CORS_ORIGIN, wildcards allowed for Vercel previews).
  // We authenticate via bearer tokens, not cookies, so credentials stay off.
  app.use(
    cors({
      origin: buildCorsOrigin(env.corsOrigin),
      // A browser hides every response header from JS except a short safe
      // list, so a cross-origin download would arrive with no filename and no
      // row count. The API and the web app are on different origins in every
      // environment, so these have to be named explicitly.
      exposedHeaders: ['Content-Disposition', 'X-Export-Rows', 'X-Export-Truncated'],
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/v1/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok' } })
  })

  app.use('/api/v1/auth', authRoutes)
  // External partners — a separate auth surface with its own token audience.
  app.use('/api/v1/partner-auth', partnerAuthRoutes)
  app.use('/api/v1/partner-invites', inviteRoutes)
  app.use('/api/v1/partner', partnerSelfRoutes)
  app.use('/api/v1/partner', partnerPushTokenRoutes)
  app.use('/api/v1/partners', partnerAdminRoutes)
  app.use('/api/v1/partner', partnerLeadRoutes)
  app.use('/api/v1/leads', staffLeadRoutes)
  app.use('/api/v1/partner', partnerRateCardRoutes)
  app.use('/api/v1/rate-card', staffRateCardRoutes)
  app.use('/api/v1/partner', partnerReferralRoutes)
  app.use('/api/v1/partner-referrals', staffPartnerReferralRoutes)
  app.use('/api/v1/payouts', payoutRoutes)
  app.use('/api/v1/partner-dashboard', partnerDashboardRoutes)
  app.use('/api/v1/users', userRoutes)
  app.use('/api/v1/zones', zoneRoutes)
  app.use('/api/v1/buildings', buildingRoutes)
  // Before /api/v1/sales so its own router never sees /tasks.
  app.use('/api/v1/sales/tasks', visitTaskRoutes)
  app.use('/api/v1/sales', salesRoutes)
  app.use('/api/v1/app-version', appVersionRoutes)
  app.use('/api/v1/app-releases', appReleaseRoutes)
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
  app.use('/api/v1/pops', popRoutes)
  app.use('/api/v1/closures', closureRoutes)
  app.use('/api/v1/splitters', splitterRoutes)
  app.use('/api/v1/fibers', fiberRoutes)

  app.use(errorHandler)
  return app
}
