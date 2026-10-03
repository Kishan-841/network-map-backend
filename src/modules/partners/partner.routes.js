import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { createPartnerService, PARTNER_DOCUMENT_TYPES } from './partner.service.js'
import { bankAccountRepository } from './bank-account.repository.js'
import { createBankAccountService } from './bank-account.service.js'
import { bankAccountSchema, redactBankBody } from './bank-account.schemas.js'
import { bankCipher } from '../../lib/bank-cipher.js'
import { partnerRepository } from './partner.repository.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { env } from '../../config/env.js'
import { notifier } from '../../lib/push/notifier.js'
import { createApprovalBypassService } from './approval-bypass.service.js'
import { createDirectPartnerService } from './direct-add.service.js'
import { partnerAuthRepository } from '../partner-auth/partner-auth.repository.js'

const service = createPartnerService({
  partnerRepository,
  storage: getStorageProvider(),
  // Tells the partner when an admin approves or rejects their documents.
  notifyPartner: notifier.notifyPartner,
  bankAccountRepository,
})
const bank = createBankAccountService({ bankAccountRepository, partnerRepository, cipher: bankCipher })
export const bankAccountService = bank
const directPartners = createDirectPartnerService({ partnerAuthRepository })
const approvalBypass = createApprovalBypassService({
  partnerAuthRepository,
  allowed: env.allowApprovalBypass,
})

const documentSchema = z.object({
  type: z.enum(PARTNER_DOCUMENT_TYPES),
  url: z.string().url(),
})
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) })

/** What a manager types to add a partner they already know. */
const addPartnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['AGENT', 'SOCIETY_REPRESENTATIVE', 'RETAIL_SHOP', 'DSA']),
  mobile: z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number'),
  // Optional, and an empty string means "not given" rather than an empty email.
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  companyName: z.string().trim().max(160).optional().or(z.literal('')),
})

// ---------------------------------------------------------------------------
// The partner's own onboarding — authenticated as a PARTNER, not staff.
// ---------------------------------------------------------------------------
export const partnerSelfRoutes = Router()
partnerSelfRoutes.use(requirePartner)

partnerSelfRoutes.get('/onboarding', async (req, res, next) => {
  try {
    const documents = await service.listDocuments(req.partner.id)
    const bankAccount = await bank.getMasked(req.partner.id)
    res.json({
      success: true,
      data: {
        status: req.partner.status,
        rejectionReason: req.partner.rejectionReason,
        required: service.requiredDocuments(),
        documents,
        bankAccount,
        // The lock rule lives in the service; the clients only read it.
        bankEditable: bank.isEditableByPartner(req.partner.status, Boolean(bankAccount)),
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

partnerSelfRoutes.put(
  '/bank-account',
  audit('PartnerBankAccount', 'Update', {
    recordId: (req) => req.partner?.id,
    describe: (req) => `Partner ${req.partner?.id} saved bank details`,
    // Never the account number — only its last 4.
    newValue: (req) => redactBankBody(req.body),
  }),
  validateBody(bankAccountSchema),
  async (req, res, next) => {
    try {
      res.json({ success: true, data: await bank.saveByPartner(req.partner, req.body) })
    } catch (err) {
      next(err)
    }
  },
)

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
    res.json({ success: true, data: await partnerRepository.listWithTotals(where) })
  } catch (err) {
    next(err)
  }
})

/**
 * Add a partner directly, with no invite link. They can sign in with their
 * mobile from this moment; the OTP flow finds them like any other partner.
 */
partnerAdminRoutes.post(
  '/',
  audit('Partner', 'Create', {
    describe: (req) => `Partner '${req.body?.name ?? 'unknown'}' added directly`,
  }),
  validateBody(addPartnerSchema),
  async (req, res, next) => {
    try {
      const partner = await directPartners.addPartner(req.body, req.user)
      res.status(201).json({
        success: true,
        data: { id: partner.id, name: partner.name, mobile: partner.mobile, status: partner.status },
      })
    } catch (err) {
      next(err)
    }
  },
)

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
