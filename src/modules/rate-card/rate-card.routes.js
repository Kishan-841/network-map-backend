import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { createRateCardService } from './rate-card.service.js'
import { rateCardRepository } from './rate-card.repository.js'

const service = createRateCardService({ rateCardRepository })

const serve = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getCurrent() })
  } catch (err) {
    next(err)
  }
}

/**
 * The partner's copy. Deliberately NOT behind assertApproved: the calculator
 * is a pitch tool, and a partner waiting on document approval can still use
 * it (partner-network.md §8).
 */
export const partnerRateCardRoutes = Router()
partnerRateCardRoutes.get('/rate-card', requirePartner, serve)

/** The employee's copy — they run the calculator during the pitch. */
export const staffRateCardRoutes = Router()
staffRateCardRoutes.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'PARTNER_MANAGER', 'MANAGER', 'SUPERVISOR'),
  serve,
)
