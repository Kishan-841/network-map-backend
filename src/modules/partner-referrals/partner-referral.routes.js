import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { createPartnerReferralService, REFERRAL_STATUSES } from './partner-referral.service.js'
import { partnerReferralRepository } from './partner-referral.repository.js'
// Lookup-by-mobile lives on the auth repository, not the profile one.
import { partnerAuthRepository } from '../partner-auth/partner-auth.repository.js'
import { inviteService } from '../partner-invites/invite.service.js'
import { env } from '../../config/env.js'

const service = createPartnerReferralService({
  partnerReferralRepository,
  partnerRepository: partnerAuthRepository,
  inviteService,
})

const introductionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['AGENT', 'SOCIETY_REPRESENTATIVE', 'RETAIL_SHOP', 'DSA']),
  mobile: z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number'),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  note: z.string().trim().max(500).optional(),
})

const statusSchema = z.object({ status: z.enum(REFERRAL_STATUSES) })

// ---------------------------------------------------------------------------
// Partner-facing
// ---------------------------------------------------------------------------
export const partnerReferralRoutes = Router()
partnerReferralRoutes.use(requirePartner)

// Deliberately not behind assertApproved — §2: a partner awaiting approval may
// refer a partner, they just may not add leads.
partnerReferralRoutes.post(
  '/partner-referrals',
  validateBody(introductionSchema),
  async (req, res, next) => {
    try {
      const referral = await service.introduce(
        { ...req.body, email: req.body.email || undefined },
        req.partner,
      )
      res.status(201).json({
        success: true,
        data: { id: referral.id, name: referral.name, status: referral.status },
      })
    } catch (err) {
      next(err)
    }
  },
)

partnerReferralRoutes.get('/partner-referrals', async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.listForPartner(req.partner.id) })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Staff-facing
// ---------------------------------------------------------------------------
export const staffPartnerReferralRoutes = Router()
// Same audience as leads: the admin and the partner managers, nobody else.
staffPartnerReferralRoutes.use(requireAuth, requireRole('ADMIN', 'PARTNER_MANAGER'))

staffPartnerReferralRoutes.get('/', async (req, res, next) => {
  try {
    const where = {
      ...(req.query.status && { status: req.query.status }),
      // Same boundary as leads: an employee works what their own partners sent.
      ...(req.user.role === 'PARTNER_MANAGER' && { employeeId: req.user.id }),
    }
    res.json({ success: true, data: await service.listForStaff(where) })
  } catch (err) {
    next(err)
  }
})

/**
 * Raise a join link for someone who was introduced.
 *
 * The raw token is returned exactly once and never stored, so the response
 * carries the only copy — the client has to show it there and then.
 */
staffPartnerReferralRoutes.post(
  '/:id/invite',
  audit('PartnerReferral', 'InviteCreate', {
    describe: (req) => `Invite link raised for introduction ${req.params.id}`,
  }),
  async (req, res, next) => {
    try {
      const invite = await service.inviteFor(req.params.id, req.user)
      res.status(201).json({
        success: true,
        data: {
          id: invite.id,
          expiresAt: invite.expiresAt,
          url: `${env.webUrl}/partner/join/${invite.token}`,
        },
      })
    } catch (err) {
      next(err)
    }
  },
)

staffPartnerReferralRoutes.patch(
  '/:id/status',
  audit('PartnerReferral', 'StatusChange', {
    describe: (req) => `Introduction ${req.params.id} → ${req.body?.status}`,
  }),
  validateBody(statusSchema),
  async (req, res, next) => {
    try {
      const referral = await service.changeStatus(req.params.id, req.body.status, req.user)
      res.json({ success: true, data: { id: referral.id, status: referral.status } })
    } catch (err) {
      next(err)
    }
  },
)
