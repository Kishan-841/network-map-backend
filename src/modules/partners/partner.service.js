import { ApiError } from '../../lib/api-error.js'

const DOC_LABEL = { AADHAAR: 'Aadhaar card', PAN: 'PAN card', CANCELLED_CHEQUE: 'Cancelled cheque' }

/** Aadhaar, PAN and a cancelled cheque — plus the bank details form (checked
 *  separately, it is not a photo). Every extra item is a partner who does not
 *  finish (partner-network.md §0), so nothing else. */
export const PARTNER_DOCUMENT_TYPES = ['AADHAAR', 'PAN', 'CANCELLED_CHEQUE']
export const requiredDocuments = () => [...PARTNER_DOCUMENT_TYPES]

// Fire-and-forget: the admin's approve/reject must never wait for, or fail
// because of, the partner's notification.
const tell = (notifyPartner, partnerId, kind) =>
  Promise.resolve()
    .then(() => notifyPartner(partnerId, kind, {}))
    .catch((err) => console.error(`[push] ${kind} failed:`, err?.message))

export function createPartnerService({ partnerRepository, storage, notifyPartner = async () => {}, bankAccountRepository = null }) {
  return {
    requiredDocuments,

    /**
     * THE gate. Every partner-facing endpoint that does commercial work
     * calls this. Hiding a button in the UI is a courtesy to the user; this
     * is the control — the same lesson as /stats/dashboard being hidden in
     * the sidebar but wide open in the API.
     */
    assertApproved(partner) {
      if (partner?.status !== 'APPROVED') {
        throw ApiError.forbidden('Your account is not approved yet')
      }
    },

    async saveDocument(partnerId, { type, url }) {
      // Same provenance rule as building photos: only files that came from
      // our own uploads API, so a stored URL can never be a foreign link.
      if (!storage?.keyFromUrl(url)) {
        throw ApiError.badRequest('File URL must come from the uploads API')
      }
      return partnerRepository.upsertDocument({
        partnerId,
        type,
        url: storage.canonicalUrl ? storage.canonicalUrl(url) : url,
      })
    },

    async submitDocuments(partnerId) {
      const partner = await partnerRepository.findById(partnerId)
      if (!partner) throw ApiError.notFound('Partner not found')
      // Only from the two states where documents are theirs to send. An
      // approved partner submitting again would drop themselves back to
      // "waiting" and lose the right to send leads.
      if (partner.status !== 'REGISTERED' && partner.status !== 'REJECTED') {
        throw ApiError.conflict('Your documents have already been submitted')
      }

      const have = new Set((await partnerRepository.listDocuments(partnerId)).map((d) => d.type))
      const missing = requiredDocuments().filter((t) => !have.has(t)).map((t) => DOC_LABEL[t])
      if (!(await bankAccountRepository?.findByPartnerId(partnerId))) missing.push('Bank account details')
      if (missing.length) throw ApiError.badRequest(`Still needed: ${missing.join(', ')}`)
      return partnerRepository.update(partnerId, { status: 'PENDING_APPROVAL' })
    },

    async approve(partnerId, adminId) {
      const partner = await partnerRepository.findById(partnerId)
      if (!partner) throw ApiError.notFound('Partner not found')
      // Approving someone who never submitted would skip the document check
      // entirely — the gate has to hold from both directions.
      if (partner.status !== 'PENDING_APPROVAL') {
        throw ApiError.badRequest('This partner has not submitted their documents yet')
      }
      const updated = await partnerRepository.update(partnerId, {
        status: 'APPROVED',
        approvedById: adminId,
        approvedAt: new Date(),
        rejectionReason: null,
      })
      tell(notifyPartner, partnerId, 'partner.approved')
      return updated
    },

    async reject(partnerId, reason, adminId) {
      const partner = await partnerRepository.findById(partnerId)
      if (!partner) throw ApiError.notFound('Partner not found')
      const updated = await partnerRepository.update(partnerId, {
        status: 'REJECTED',
        rejectionReason: reason,
        approvedById: adminId,
        approvedAt: null,
      })
      // Their next step is theirs — upload again — so they should hear now.
      tell(notifyPartner, partnerId, 'partner.rejected')
      return updated
    },

    /** Documents leave signed, exactly like building photos. */
    async listDocuments(partnerId) {
      const docs = await partnerRepository.listDocuments(partnerId)
      if (!storage?.readUrl) return docs
      return Promise.all(docs.map(async (d) => ({ ...d, url: await storage.readUrl(d.url) })))
    },
  }
}
