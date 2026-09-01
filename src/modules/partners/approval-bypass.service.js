import { ApiError } from '../../lib/api-error.js'

/**
 * Approve yourself, skipping document upload.
 *
 * This exists so testing does not mean uploading a real photograph of an
 * identity document to a bucket that is still public (partner-network.md §13).
 * It is a partner granting themselves the only status that may create leads,
 * which in production would be an open door — so it is off unless
 * ALLOW_APPROVAL_BYPASS is set, and `env.js` refuses to boot with that set in
 * production at all.
 *
 * Off answers 404 rather than 403: a disabled shortcut should not advertise
 * that it is merely switched off.
 */
export function createApprovalBypassService({ partnerAuthRepository, allowed }) {
  return {
    async approveSelf(partner) {
      if (allowed !== true) throw ApiError.notFound('Not found')

      // Suspension is a deliberate act by an admin. A testing shortcut must
      // not become a way to undo one.
      if (partner.status === 'SUSPENDED') {
        throw ApiError.forbidden('This account is closed')
      }

      return partnerAuthRepository.update(partner.id, {
        status: 'APPROVED',
        rejectionReason: null,
      })
    },
  }
}
