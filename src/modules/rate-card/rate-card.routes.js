import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { createRateCardService } from './rate-card.service.js'
import { rateCardRepository } from './rate-card.repository.js'
import { DSA_FIXED_AMOUNT, fixedAmountFor } from '../earnings/commission.js'

const service = createRateCardService({ rateCardRepository })

// `extra(req)` adds what each audience needs on top of the card itself.
const serve = (extra) => async (req, res, next) => {
  try {
    res.json({ success: true, data: { ...(await service.getCurrent()), ...extra(req) } })
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
// A partner paid a flat amount (a DSA) is told so; the app shows that
// instead of the calculator. Null means "paid from the rate card".
partnerRateCardRoutes.get(
  '/rate-card',
  requirePartner,
  serve((req) => ({ fixedPerCustomer: fixedAmountFor(req.partner.type) })),
)

/** The employee's copy — they run the calculator during the pitch. */
export const staffRateCardRoutes = Router()
staffRateCardRoutes.get(
  '/',
  requireAuth,
  // The rate card IS the commission structure — what every partner is paid.
  // Same audience as the rest of the partner network.
  requireRole('ADMIN', 'PARTNER_MANAGER'),
  // So the "Mark converted" preview can show a DSA's flat amount.
  serve(() => ({ dsaFixedAmount: DSA_FIXED_AMOUNT })),
)
