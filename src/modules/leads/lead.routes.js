import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { validateBody } from '../../middleware/validate.js'
import { feasibilityLimiter } from '../../middleware/rate-limit.js'
import { audit } from '../system-logs/audit.js'
import { createLeadService, LEAD_STATUSES } from './lead.service.js'
import { leadRepository, demandRepository } from './lead.repository.js'
import { createLeadCaptureService } from './lead-capture.service.js'
import { createBuildingSearchService } from '../partners/building-search.service.js'
import { BILLING_PERIODS } from '../rate-card/rate-card.service.js'
import { createPartnerService } from '../partners/partner.service.js'
import { partnerRepository } from '../partners/partner.repository.js'
import { buildingRepository } from '../buildings/building.repository.js'
import { createEarningService } from '../earnings/earning.service.js'
import { earningRepository } from '../earnings/earning.repository.js'
import { rateCardRepository } from '../rate-card/rate-card.repository.js'
import { getStorageProvider } from '../../lib/storage/index.js'

const earningService = createEarningService({ earningRepository, rateCardRepository })
const leadService = createLeadService({ leadRepository, earningService })
const capture = createLeadCaptureService({ buildingRepository, leadRepository })
const buildingSearch = createBuildingSearchService({ buildingRepository })
const partners = createPartnerService({ partnerRepository, storage: getStorageProvider() })

const placeSchema = z.object({
  placeId: z.string().trim().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  placeName: z.string().trim().max(200).optional(),
})

/**
 * What the partner fills in. Deliberately short — every field we remove is a
 * partner who finishes (partner-network.md §0). No email, and no buildingId:
 * the server decides which building this is, not the browser.
 */
const leadSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerMobile: z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number'),
  requirementMbps: z.coerce.number().int().refine((n) => [100, 200, 300, 400].includes(n), {
    message: 'Pick a speed',
  }),
  placeId: z.string().trim().max(200).optional(),
  placeName: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  note: z.string().trim().max(500).optional(),
})

/**
 * Converting a lead needs the plan the customer actually took — the lead only
 * ever recorded what they asked for, and the rate card is keyed on speed AND
 * billing period. The service rejects CONVERTED without it.
 */
const planSchema = z.object({
  speedMbps: z.coerce.number().int().positive(),
  billingPeriod: z.enum(BILLING_PERIODS),
})

const statusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  note: z.string().trim().max(500).optional(),
  plan: planSchema.optional(),
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

/**
 * The green / amber / red signal for a searched building. Returns a single
 * word — never the building itself, which is why the buildingId that
 * matchPlace also produces is dropped here.
 */
partnerLeadRoutes.post(
  '/building-signal',
  feasibilityLimiter,
  validateBody(placeSchema),
  async (req, res, next) => {
    try {
      partners.assertApproved(req.partner)
      const { match } = await capture.matchPlace(req.body)
      if (match === 'NOT_FOUND' && demandRepository) {
        // Worth knowing what people are asking for, even when the answer is no.
        await demandRepository.record({
          partnerId: req.partner.id,
          placeId: req.body.placeId ?? null,
          name: req.body.placeName ?? null,
          latitude: req.body.latitude,
          longitude: req.body.longitude,
          matchedBuildingId: null,
        })
      }
      res.json({ success: true, data: { match } })
    } catch (err) {
      next(err)
    }
  },
)

partnerLeadRoutes.post('/leads', validateBody(leadSchema), async (req, res, next) => {
  try {
    const lead = await capture.capture(req.body, req.partner)
    // Never echo the internal attribution back to the partner.
    res.status(201).json({
      success: true,
      data: {
        id: lead.id,
        status: lead.status,
        customerName: lead.customerName,
        buildingMatch: lead.buildingMatch,
      },
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

/** The Earnings tab: month by month, and what we still owe. */
partnerLeadRoutes.get('/earnings', async (req, res, next) => {
  try {
    partners.assertApproved(req.partner)
    res.json({ success: true, data: await earningService.statementFor(req.partner.id) })
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
  // A partner manager works their own partners' leads; the service enforces
  // which ones those are.
  requireRole('ADMIN', 'MANAGER', 'SUPERVISOR', 'PARTNER_MANAGER'),
  audit('Lead', 'StatusChange', { describe: (req) => `Lead ${req.params.id} → ${req.body?.status}` }),
  validateBody(statusSchema),
  async (req, res, next) => {
    try {
      const lead = await leadService.changeStatus(
        req.params.id, req.body.status, req.user, req.body.note, req.body.plan,
      )
      res.json({ success: true, data: { id: lead.id, status: lead.status } })
    } catch (err) {
      next(err)
    }
  },
)
