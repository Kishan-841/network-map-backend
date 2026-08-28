import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { audit } from '../system-logs/audit.js'
import { inviteService } from './invite.service.js'
import { inviteRepository } from './invite.repository.js'
import { env } from '../../config/env.js'
import { ApiError } from '../../lib/api-error.js'

export const inviteRoutes = Router()

const MANAGES_PARTNERS = ['ADMIN', 'PARTNER_MANAGER']

// Public: the join page resolves a token to show who invited the partner.
// Returns the employee's NAME only — never the invite id or the employee id.
inviteRoutes.get('/resolve/:token', async (req, res, next) => {
  try {
    const invite = await inviteService.peekInvite(req.params.token)
    const full = await inviteRepository.findById(invite.id)
    res.json({
      success: true,
      data: { employeeName: full?.employee?.name ?? null, valid: true },
    })
  } catch (err) {
    next(err)
  }
})

inviteRoutes.use(requireAuth, requireRole(...MANAGES_PARTNERS))

inviteRoutes.post(
  '/',
  audit('Partner', 'InviteCreate', { describe: () => 'Partner invite created' }),
  async (req, res, next) => {
    try {
      const invite = await inviteService.createInvite({ employeeId: req.user.id })
      res.status(201).json({
        success: true,
        data: { ...invite, url: `${env.webUrl}/partner/join/${invite.token}` },
      })
    } catch (err) {
      next(err)
    }
  },
)

inviteRoutes.get('/', async (req, res, next) => {
  try {
    // An employee sees their own invites; an admin sees everyone's.
    const items =
      req.user.role === 'ADMIN'
        ? await inviteRepository.listAll()
        : await inviteRepository.listForEmployee(req.user.id)
    // The token hash never leaves the server — it is not secret, but it is
    // not useful to a client either, and shipping it invites misuse.
    res.json({
      success: true,
      data: items.map(({ tokenHash, ...invite }) => invite),
    })
  } catch (err) {
    next(err)
  }
})

inviteRoutes.post(
  '/:id/revoke',
  audit('Partner', 'InviteRevoke', { describe: (req) => `Partner invite ${req.params.id} revoked` }),
  async (req, res, next) => {
    try {
      const invite = await inviteRepository.findById(req.params.id)
      if (!invite) return next(ApiError.notFound('Invite not found'))
      // An employee may only revoke their own.
      if (req.user.role !== 'ADMIN' && invite.employeeId !== req.user.id) {
        return next(ApiError.notFound('Invite not found'))
      }
      await inviteRepository.revoke(req.params.id)
      res.json({ success: true, data: { revoked: true } })
    } catch (err) {
      next(err)
    }
  },
)
