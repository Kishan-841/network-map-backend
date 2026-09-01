import { randomBytes, createHash } from 'node:crypto'
import { ApiError } from '../../lib/api-error.js'
import { env } from '../../config/env.js'
import { inviteRepository } from './invite.repository.js'

/**
 * A fast hash is the right choice here, unlike a password: the token is 24
 * bytes of CSPRNG entropy, so there is nothing to brute-force, and lookup
 * needs to be a single indexed query rather than a scan-and-compare.
 */
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export function createInviteService({ inviteRepository }) {
  // One message for unknown / expired / used / revoked. The person holding a
  // dead link does not need to know which kind of dead it is.
  const dead = () => ApiError.badRequest('This invite link is no longer valid')

  return {
    async createInvite({ employeeId, referralId = null }) {
      const token = randomBytes(24).toString('hex')
      const expiresAt = new Date(Date.now() + env.partnerInviteTtlDays * 24 * 60 * 60 * 1000)
      const invite = await inviteRepository.create({
        tokenHash: hashToken(token),
        employeeId,
        // Set when the link was raised for a specific introduction, so using
        // it can close that introduction out.
        referralId,
        expiresAt,
      })
      // The raw token is returned exactly once and never stored. If the
      // employee loses it, they issue a new invite.
      return { id: invite.id, token, expiresAt }
    },

    /** Validate a token and return the invite, without consuming it. */
    async peekInvite(token) {
      const invite = await inviteRepository.findByTokenHash(hashToken(token))
      if (!invite) throw dead()
      if (invite.revokedAt) throw dead()
      if (invite.usedAt) throw dead()
      if (new Date(invite.expiresAt).getTime() < Date.now()) throw dead()
      return invite
    },

    markUsed: (inviteId, partnerId) => inviteRepository.markUsed(inviteId, partnerId),
    revoke: (inviteId) => inviteRepository.revoke(inviteId),
  }
}

export const inviteService = createInviteService({ inviteRepository })
