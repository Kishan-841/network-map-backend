import { ApiError } from '../../lib/api-error.js'

export const LEAD_STATUSES = [
  'NEW', 'CONTACTED', 'INTERESTED', 'CONVERTED', 'NOT_INTERESTED', 'UNREACHABLE', 'DUPLICATE',
]

export function createLeadService({ leadRepository }) {
  return {
    async createLead(input, partner) {
      // The gate again, on the server. A partner who is not approved has no
      // commercial capability at all.
      if (partner?.status !== 'APPROVED') {
        throw ApiError.forbidden('Your account is not approved yet')
      }

      // First referral of a customer keeps the claim. The second is still
      // recorded — we want to know it happened — but flagged, and the partner
      // is told nothing about who got there first.
      const existing = await leadRepository.findOpenByMobile(input.customerMobile)

      const created = await leadRepository.create({
        ...input,
        partnerId: partner.id,
        // A SNAPSHOT, not a live lookup: re-assigning this partner to another
        // employee tomorrow must not silently move yesterday's commission.
        employeeId: partner.onboardedById ?? null,
        status: existing ? 'DUPLICATE' : 'NEW',
        duplicateOfId: existing?.id ?? null,
      })

      await leadRepository.recordEvent({
        leadId: created.id,
        fromStatus: null,
        toStatus: created.status,
      })
      return created
    },

    listForPartner: (partnerId) => leadRepository.listByPartner(partnerId),

    async changeStatus(leadId, toStatus, byUserId, note) {
      if (!LEAD_STATUSES.includes(toStatus)) throw ApiError.badRequest('Unknown lead status')
      const lead = await leadRepository.findById(leadId)
      if (!lead) throw ApiError.notFound('Lead not found')

      const updated = await leadRepository.update(leadId, { status: toStatus })
      await leadRepository.recordEvent({
        leadId,
        fromStatus: lead.status,
        toStatus,
        byUserId,
        note: note ?? null,
      })
      return updated
    },
  }
}
