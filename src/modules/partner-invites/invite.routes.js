import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { audit } from '../system-logs/audit.js'
import { inviteService } from './invite.service.js'
import { inviteRepository } from './invite.repository.js'
import { env } from '../../config/env.js'
import { ApiError } from '../../lib/api-error.js'
import { PARTNER_STAFF, ownPartnersOnly } from '../../lib/partner-access.js'

/** Loopback only: http://localhost:3001, http://127.0.0.1:3000, … */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

/**
 * Where the invite link should point.
 *
 * This link carries a live invite token and is copied by an employee and sent
 * to an outsider, so its base must never be attacker-influenceable:
 *
 *  - WEB_URL, when set, always wins. That is the production answer, and in
 *    production nothing else is consulted.
 *  - Outside production only, a LOOPBACK origin is accepted, so development
 *    works on whatever port Next picked without anyone remembering a config
 *    value. A real attacker origin is a routable domain, not localhost.
 *  - Otherwise the configured fallback.
 *
 * A request header alone is not trusted input for this.
 */
export function inviteBaseUrl(req, { nodeEnv = process.env.NODE_ENV } = {}) {
  if (process.env.WEB_URL) return process.env.WEB_URL
  if (nodeEnv !== 'production') {
    const origin = (req.get?.('origin') ?? '').replace(/\/$/, '')
    if (LOOPBACK_ORIGIN.test(origin)) return origin
  }
  return env.webUrl
}

export const inviteRoutes = Router()

const MANAGES_PARTNERS = PARTNER_STAFF

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
        data: { ...invite, url: `${inviteBaseUrl(req)}/partner/join/${invite.token}` },
      })
    } catch (err) {
      next(err)
    }
  },
)

inviteRoutes.get('/', async (req, res, next) => {
  try {
    // A partner manager sees their own invites; admin and sales manager see everyone's.
    const items = ownPartnersOnly(req.user)
      ? await inviteRepository.listForEmployee(req.user.id)
      : await inviteRepository.listAll()
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
      // A partner manager may only revoke their own.
      if (ownPartnersOnly(req.user) && invite.employeeId !== req.user.id) {
        return next(ApiError.notFound('Invite not found'))
      }
      await inviteRepository.revoke(req.params.id)
      res.json({ success: true, data: { revoked: true } })
    } catch (err) {
      next(err)
    }
  },
)
