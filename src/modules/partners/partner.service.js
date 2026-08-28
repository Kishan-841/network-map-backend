import { ApiError } from '../../lib/api-error.js'

const DOC_LABEL = { AADHAAR: 'Aadhaar card', PAN: 'PAN card', GST: 'GST certificate' }

/** Aadhaar and PAN always; GST only when the partner says they have one. */
export const requiredDocuments = (partner) =>
  partner?.hasGst ? ['AADHAAR', 'PAN', 'GST'] : ['AADHAAR', 'PAN']

export function createPartnerService({ partnerRepository, storage }) {
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

      const have = new Set((await partnerRepository.listDocuments(partnerId)).map((d) => d.type))
      const missing = requiredDocuments(partner).filter((t) => !have.has(t))
      if (missing.length) {
        throw ApiError.badRequest(
          `Still needed: ${missing.map((t) => DOC_LABEL[t]).join(', ')}`,
        )
      }
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
      return partnerRepository.update(partnerId, {
        status: 'APPROVED',
        approvedById: adminId,
        approvedAt: new Date(),
        rejectionReason: null,
      })
    },

    async reject(partnerId, reason, adminId) {
      const partner = await partnerRepository.findById(partnerId)
      if (!partner) throw ApiError.notFound('Partner not found')
      return partnerRepository.update(partnerId, {
        status: 'REJECTED',
        rejectionReason: reason,
        approvedById: adminId,
        approvedAt: null,
      })
    },

    /** Documents leave signed, exactly like building photos. */
    async listDocuments(partnerId) {
      const docs = await partnerRepository.listDocuments(partnerId)
      if (!storage?.readUrl) return docs
      return Promise.all(docs.map(async (d) => ({ ...d, url: await storage.readUrl(d.url) })))
    },
  }
}
