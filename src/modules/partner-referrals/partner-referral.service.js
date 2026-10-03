import { ApiError } from '../../lib/api-error.js'

export const REFERRAL_STATUSES = ['NEW', 'CONTACTED', 'JOINED', 'DECLINED']

/** Live introductions — a declined one is not a permanent block on a person. */
export const OPEN_REFERRAL_STATUSES = ['NEW', 'CONTACTED']

/** The one link that could still be used: not used, not revoked, not expired. */
const liveInvite = (invites = []) =>
  invites.find(
    (i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt).getTime() > Date.now(),
  ) ?? null

export function createPartnerReferralService({
  partnerReferralRepository,
  partnerRepository,
  inviteService,
}) {
  /** Same boundary as changeStatus, so both writes agree on whose row this is. */
  const mine = async (id, actor) => {
    const referral = await partnerReferralRepository.findById(id)
    const missing = () => ApiError.notFound('Introduction not found')
    if (!referral) throw missing()
    if (actor?.role === 'PARTNER_MANAGER' && referral.employeeId !== actor.id) throw missing()
    return referral
  }

  return {
    /**
     * Raise a join link for someone who was introduced.
     *
     * Bound to the introduction, so when the link is used we know which
     * introduction became a partner without matching on a phone number.
     *
     * Any link still alive is revoked first: two working links for one person
     * means two accounts if both are opened, and the second would have no
     * introduction to close.
     */
    async inviteFor(id, actor) {
      const referral = await mine(id, actor)
      if (referral.status === 'JOINED') {
        throw ApiError.conflict('They have already joined')
      }

      const live = liveInvite(referral.invites)
      if (live) await inviteService.revoke(live.id)

      const invite = await inviteService.createInvite({
        // The link carries the manager who sent it, so whoever signs up
        // through it is attributed to them.
        employeeId: referral.employeeId ?? actor.id,
        referralId: referral.id,
      })

      // Sending a link means the conversation happened. Only nudged off NEW —
      // a manager who has already set something else keeps it.
      if (referral.status === 'NEW') {
        await partnerReferralRepository.update(referral.id, { status: 'CONTACTED' })
      }
      return invite
    },

    /**
     * The link was used and an account now exists.
     *
     * Called from registration, so it must never throw the signup away: an
     * introduction that has since been deleted is a no-op, not an error.
     */
    async markJoined(id, partnerId) {
      const referral = await partnerReferralRepository.findById(id)
      if (!referral) return null
      return partnerReferralRepository.update(id, {
        status: 'JOINED',
        joinedPartnerId: partnerId,
      })
    },

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
