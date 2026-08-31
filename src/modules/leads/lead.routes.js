import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { validateBody } from '../../middleware/validate.js'
import { feasibilityLimiter } from '../../middleware/rate-limit.js'
import { audit } from '../system-logs/audit.js'
import { createLeadService, LEAD_STATUSES } from './lead.service.js'
import { leadRepository, demandRepository } from './lead.repository.js'
import { createFeasibilityService } from '../partners/feasibility.service.js'
import { createBuildingSearchService } from '../partners/building-search.service.js'
import { createPartnerService } from '../partners/partner.service.js'
import { partnerRepository } from '../partners/partner.repository.js'
import { buildingRepository } from '../buildings/building.repository.js'
import { getStorageProvider } from '../../lib/storage/index.js'

const leadService = createLeadService({ leadRepository })
const feasibility = createFeasibilityService({ buildingRepository, demandRepository })
const buildingSearch = createBuildingSearchService({ buildingRepository })
const partners = createPartnerService({ partnerRepository, storage: getStorageProvider() })

const feasibilitySchema = z.object({
  placeId: z.string().trim().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  name: z.string().trim().max(200).optional(),
})

const leadSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerMobile: z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number'),
  customerEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  address: z.string().trim().max(300).optional(),
  note: z.string().trim().max(500).optional(),
  buildingId: z.string().trim().optional(),
})

const statusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  note: z.string().trim().max(500).optional(),
})

// ---------------------------------------------------------------------------
// Partner-facing
// ---------------------------------------------------------------------------
export const partnerLeadRoutes = Router()
partnerLeadRoutes.use(requirePartner)

/**
 * Search OUR registry. Replaces the Google Places lookup the referral flow
 * used to run: a partner picks a building we actually hold, so there is no
 * coordinate-matching step to get wrong.
 */
partnerLeadRoutes.get('/buildings/search', feasibilityLimiter, async (req, res, next) => {
  try {
    partners.assertApproved(req.partner)
    res.json({ success: true, data: await buildingSearch.search(req.query.q) })
  } catch (err) {
    next(err)
  }
})

partnerLeadRoutes.post(
  '/feasibility',
  feasibilityLimiter,
  validateBody(feasibilitySchema),
  async (req, res, next) => {
    try {
      partners.assertApproved(req.partner)
      res.json({ success: true, data: await feasibility.check(req.body, req.partner.id) })
    } catch (err) {
      next(err)
    }
  },
)

partnerLeadRoutes.post('/leads', validateBody(leadSchema), async (req, res, next) => {
  try {
    // The client says which building was picked; the server decides whether we
    // serve it. Never trust a flag that came back from the browser.
    if (req.body.buildingId) await buildingSearch.assertServiceable(req.body.buildingId)
    const body = { ...req.body, customerEmail: req.body.customerEmail || null }
    const lead = await leadService.createLead(body, req.partner)
    // Never echo the internal attribution back to the partner.
    res.status(201).json({
      success: true,
      data: { id: lead.id, status: lead.status, customerName: lead.customerName },
    })
  } catch (err) {
    next(err)
  }
})

partnerLeadRoutes.get('/leads', async (req, res, next) => {
  try {
    partners.assertApproved(req.partner)
    res.json({ success: true, data: await leadService.listForPartner(req.partner.id) })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Staff-facing
// ---------------------------------------------------------------------------
export const staffLeadRoutes = Router()
staffLeadRoutes.use(requireAuth, requireRole('ADMIN', 'MANAGER', 'PARTNER_MANAGER', 'SUPERVISOR'))

staffLeadRoutes.get('/', async (req, res, next) => {
  try {
    const where = {
      ...(req.query.status && { status: req.query.status }),
      ...(req.query.partnerId && { partnerId: req.query.partnerId }),
      // An employee sees leads from the partners they recruited, nobody else's.
      ...(req.user.role === 'PARTNER_MANAGER' && { employeeId: req.user.id }),
    }
    res.json({ success: true, data: await leadRepository.listForStaff(where) })
  } catch (err) {
    next(err)
  }
})

staffLeadRoutes.patch(
  '/:id/status',
  requireRole('ADMIN', 'MANAGER', 'SUPERVISOR'),
  audit('Lead', 'StatusChange', { describe: (req) => `Lead ${req.params.id} → ${req.body?.status}` }),
  validateBody(statusSchema),
  async (req, res, next) => {
    try {
      const lead = await leadService.changeStatus(
        req.params.id, req.body.status, req.user.id, req.body.note,
      )
      res.json({ success: true, data: { id: lead.id, status: lead.status } })
    } catch (err) {
      next(err)
    }
  },
)
