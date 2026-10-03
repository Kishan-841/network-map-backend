import { ApiError } from '../../lib/api-error.js'

/**
 * A partner manager adding someone they already know, without an invite link.
 *
 * The account exists from that moment, so the person signs in with their
 * mobile like any other partner — the OTP flow finds them and issues a token
 * rather than sending them through signup.
 *
 * They start at REGISTERED. Being added by someone who vouches for you is not
 * the same as having shown us an identity document, and the gate that stops a
 * partner creating leads until they are approved stays exactly where it is.
 */
export function createDirectPartnerService({ partnerAuthRepository }) {
  return {
    async addPartner(input, actor) {
      const mobile = String(input.mobile ?? '').trim()
      const email = input.email?.trim() || null

      if (await partnerAuthRepository.findByMobile(mobile)) {
        throw ApiError.conflict('That mobile number is already a partner')
      }
      // Only when one was given: email is optional, and looking up null would
      // match the first partner without one.
      if (email && (await partnerAuthRepository.findByEmail(email))) {
        throw ApiError.conflict('That email is already a partner')
      }

      return partnerAuthRepository.create({
        name: String(input.name ?? '').trim(),
        type: input.type,
        mobile,
        // null, never '': the column is unique, so a second empty string
        // would collide with the first.
        email,
        companyName: input.companyName?.trim() || null,
        status: 'REGISTERED',
        onboardedById: actor.id,
      })
    },
  }
}
