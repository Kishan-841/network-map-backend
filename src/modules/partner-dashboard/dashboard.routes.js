import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { createPartnerDashboardService } from './dashboard.service.js'
import { dashboardRepository } from './dashboard.repository.js'
import { PARTNER_STAFF } from '../../lib/partner-access.js'

const service = createPartnerDashboardService({ dashboardRepository })

export const partnerDashboardRoutes = Router()
// Same audience as the rest of the partner network.
partnerDashboardRoutes.use(requireAuth, requireRole(...PARTNER_STAFF))

partnerDashboardRoutes.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.overview(req.user) })
  } catch (err) {
    next(err)
  }
})
