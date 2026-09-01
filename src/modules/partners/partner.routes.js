import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { createPartnerService } from './partner.service.js'
import { partnerRepository } from './partner.repository.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { env } from '../../config/env.js'
import { createApprovalBypassService } from './approval-bypass.service.js'
import { partnerAuthRepository } from '../partner-auth/partner-auth.repository.js'

const service = createPartnerService({ partnerRepository, storage: getStorageProvider() })
const approvalBypass = createApprovalBypassService({
  partnerAuthRepository,
  allowed: env.allowApprovalBypass,
})

const documentSchema = z.object({
  type: z.enum(['AADHAAR', 'PAN']),
  url: z.string().url(),
})
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) })

// ---------------------------------------------------------------------------
// The partner's own onboarding — authenticated as a PARTNER, not staff.
// ---------------------------------------------------------------------------
export const partnerSelfRoutes = Router()
partnerSelfRoutes.use(requirePartner)

partnerSelfRoutes.get('/onboarding', async (req, res, next) => {
  try {
    const documents = await service.listDocuments(req.partner.id)
    res.json({
      success: true,
      data: {
        status: req.partner.status,
        rejectionReason: req.partner.rejectionReason,
        required: service.requiredDocuments(),
        documents,
        // The browser cannot be trusted to know whether the shortcut is on,
        // so the server says. False in production, always.
        bypassAvailable: env.allowApprovalBypass === true,
      },
    })
  } catch (err) {
    next(err)
  }
})

partnerSelfRoutes.post('/documents', validateBody(documentSchema), async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await service.saveDocument(req.partner.id, req.body) })
  } catch (err) {
    next(err)
  }
})

/**
 * TESTING ONLY — approve yourself and skip the upload entirely. 404s unless
 * ALLOW_APPROVAL_BYPASS is set, and the server refuses to boot with that set
 * in production. Audited, so a use of it is never silent.
 */
partnerSelfRoutes.post(
  '/documents/bypass',
  audit('Partner', 'ApprovalBypass', {
    describe: (req) => `Partner ${req.partner?.id} self-approved (testing bypass)`,
  }),
  async (req, res, next) => {
    try {
      const updated = await approvalBypass.approveSelf(req.partner)
      res.json({ success: true, data: { status: updated.status } })
    } catch (err) {
      next(err)
    }
  },
)

partnerSelfRoutes.post('/documents/submit', async (req, res, next) => {
  try {
    const updated = await service.submitDocuments(req.partner.id)
    res.json({ success: true, data: { status: updated.status } })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Staff view: the approval queue and the roster.
// ---------------------------------------------------------------------------
export const partnerAdminRoutes = Router()
partnerAdminRoutes.use(requireAuth, requireRole('ADMIN', 'PARTNER_MANAGER'))

partnerAdminRoutes.get('/', async (req, res, next) => {
  try {
    const where = {
      ...(req.query.status && { status: req.query.status }),
      // An employee sees only the partners they recruited.
      ...(req.user.role !== 'ADMIN' && { onboardedById: req.user.id }),
    }
    res.json({ success: true, data: await partnerRepository.list(where) })
  } catch (err) {
    next(err)
  }
})

partnerAdminRoutes.get('/:id/documents', requireRole('ADMIN'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.listDocuments(req.params.id) })
  } catch (err) {
    next(err)
  }
})

// Approval is ADMIN-only: the employee who recruited a partner should not be
// the one clearing their paperwork, especially once commission is attached.
partnerAdminRoutes.post(
  '/:id/approve',
  requireRole('ADMIN'),
  audit('Partner', 'Approve', { describe: (req) => `Partner ${req.params.id} approved` }),
  async (req, res, next) => {
    try {
      const p = await service.approve(req.params.id, req.user.id)
      res.json({ success: true, data: { status: p.status } })
    } catch (err) {
      next(err)
    }
  },
)

partnerAdminRoutes.post(
  '/:id/reject',
  requireRole('ADMIN'),
  audit('Partner', 'Reject', { describe: (req) => `Partner ${req.params.id} rejected` }),
  validateBody(rejectSchema),
  async (req, res, next) => {
    try {
      const p = await service.reject(req.params.id, req.body.reason, req.user.id)
      res.json({ success: true, data: { status: p.status } })
    } catch (err) {
      next(err)
    }
  },
)

export const partnerService = service
