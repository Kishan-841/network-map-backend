import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { createPayoutService, PAYMENT_METHODS } from './payout.service.js'
import { earningRepository } from './earning.repository.js'

const service = createPayoutService({ earningRepository })

const markPaidSchema = z.object({
  partnerId: z.string().trim().min(1),
  month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Not a valid month'),
  amountPaid: z.coerce.number().int().positive('Enter the amount that was paid'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
  note: z.string().trim().max(300).optional().or(z.literal('')),
  // A date only — the money moved on a day, not at a time.
  paidOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Not a valid date').optional(),
})

export const payoutRoutes = Router()
// Finance and the admin. A partner manager recruits and supports partners;
// recording that money left the building is a different job, and keeping the
// two apart means neither can both create an earning and settle it.
payoutRoutes.use(requireAuth, requireRole('ADMIN', 'ACCOUNTS'))

payoutRoutes.get('/', async (req, res, next) => {
  try {
    const [outstanding, settled] = await Promise.all([service.outstanding(), service.settled()])
    res.json({ success: true, data: { ...outstanding, settled } })
  } catch (err) {
    next(err)
  }
})

payoutRoutes.post(
  '/mark-paid',
  audit('Partner', 'PayoutRecorded', {
    describe: (req, old, body) =>
      `Paid ₹${req.body?.amountPaid} to ${req.body?.partnerId} for ${req.body?.month} ` +
      `by ${req.body?.method}${req.body?.reference ? ` (${req.body.reference})` : ''}` +
      (body?.data ? ` — ${body.data.count} earning(s)` : ''),
  }),
  validateBody(markPaidSchema),
  async (req, res, next) => {
    try {
      res.json({ success: true, data: await service.markPaid(req.body, req.user) })
    } catch (err) {
      next(err)
    }
  },
)
