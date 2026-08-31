import { ApiError } from '../../lib/api-error.js'

export const LEAD_STATUSES = [
  'NEW', 'CONTACTED', 'INTERESTED', 'CONVERTED', 'NOT_INTERESTED', 'UNREACHABLE', 'DUPLICATE',
]

export function createLeadService({ leadRepository, earningService }) {
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

    /**
     * Move a lead along.
     *
     * `actor` is the staff user, not an id: a partner manager may only work
     * leads from the partners THEY onboarded, which is the same boundary the
     * list enforces. Applied here too, because otherwise any employee could
     * reach any lead by guessing an id.
     *
     * Out of scope answers 404, not 403 — someone else's lead should not be
     * confirmed to exist.
     *
     * CONVERTED is the moment money comes into existence, so the earning is
     * settled BEFORE the status moves. A lead sitting in Converted with no
     * earning behind it is the exact silent gap this is here to close, and a
     * lead whose earning is already paid cannot be moved out at all
     * (partner-network.md §6.2).
     */
    async changeStatus(leadId, toStatus, actor, note, plan) {
      if (!LEAD_STATUSES.includes(toStatus)) throw ApiError.badRequest('Unknown lead status')

      const lead = await leadRepository.findById(leadId)
      const missing = () => ApiError.notFound('Lead not found')
      if (!lead) throw missing()
      if (actor?.role === 'PARTNER_MANAGER' && lead.employeeId !== actor.id) throw missing()

      if (earningService) {
        if (toStatus === 'CONVERTED' && lead.status !== 'CONVERTED') {
          if (!plan?.speedMbps || !plan?.billingPeriod) {
            throw ApiError.badRequest('Record which plan the customer took before converting')
          }
          await earningService.recordConversion(lead, plan)
        } else if (lead.status === 'CONVERTED' && toStatus !== 'CONVERTED') {
          await earningService.revokeConversion(leadId)
        }
      }

      const updated = await leadRepository.update(leadId, { status: toStatus })
      await leadRepository.recordEvent({
        leadId,
        fromStatus: lead.status,
        toStatus,
        byUserId: actor?.id ?? null,
        note: note ?? null,
      })
      return updated
    },
  }
}
