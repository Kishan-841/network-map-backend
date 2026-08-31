import { ApiError } from '../../lib/api-error.js'

export const REFERRAL_STATUSES = ['NEW', 'CONTACTED', 'JOINED', 'DECLINED']

/** Live introductions — a declined one is not a permanent block on a person. */
export const OPEN_REFERRAL_STATUSES = ['NEW', 'CONTACTED']

export function createPartnerReferralService({ partnerReferralRepository, partnerRepository }) {
  return {
    /**
     * A partner introduces someone who could also send us customers.
     *
     * Allowed while the referrer is still awaiting approval: partner-network.md
     * §2 settles that the pitch tools work from minute one and only adding
     * leads waits on documents. A suspended account is a different matter.
     */
    async introduce(input, referrer) {
      if (referrer?.status === 'SUSPENDED' || referrer?.status === 'REJECTED') {
        throw ApiError.forbidden('Your account cannot make introductions')
      }
      if (input.mobile === referrer.mobile) {
        throw ApiError.badRequest('That is your own number')
      }

      // Neutral on purpose: "already with us" must not become a way to probe
      // whether a given number is one of our partners, or whose.
      const alreadyPartner = await partnerRepository.findByMobile(input.mobile)
      if (alreadyPartner) {
        throw ApiError.conflict('That number is already with us')
      }
      const alreadyIntroduced = await partnerReferralRepository.findOpenByMobile(input.mobile)
      if (alreadyIntroduced) {
        throw ApiError.conflict('Someone has already introduced this person')
      }

      return partnerReferralRepository.create({
        referredById: referrer.id,
        // Snapshot, mirroring Lead and PartnerEarning: re-assigning the
        // referrer later must not move an introduction already queued.
        employeeId: referrer.onboardedById ?? null,
        name: input.name,
        type: input.type,
        mobile: input.mobile,
        email: input.email ?? null,
        note: input.note ?? null,
      })
    },

    listForPartner: (partnerId) => partnerReferralRepository.listForPartner(partnerId),
    listForStaff: (where) => partnerReferralRepository.listForStaff(where),

    /**
     * Move an introduction along. Scoped exactly like leads: a partner manager
     * works the introductions their own partners made and nobody else's, and
     * out of scope answers 404 rather than confirming the row exists.
     */
    async changeStatus(id, toStatus, actor) {
      if (!REFERRAL_STATUSES.includes(toStatus)) {
        throw ApiError.badRequest('Unknown status')
      }
      const referral = await partnerReferralRepository.findById(id)
      const missing = () => ApiError.notFound('Introduction not found')
      if (!referral) throw missing()
      if (actor?.role === 'PARTNER_MANAGER' && referral.employeeId !== actor.id) throw missing()

      return partnerReferralRepository.update(id, { status: toStatus })
    },
  }
}
