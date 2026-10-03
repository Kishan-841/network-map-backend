import jwt from 'jsonwebtoken'
import { ApiError } from '../../lib/api-error.js'
import { env } from '../../config/env.js'
import { generateOtp, hashOtp, verifyOtp as bcryptVerifyOtp } from '../../lib/otp.js'

// Indian mobile: 10 digits, never starting 0-5.
const MOBILE = /^[6-9][0-9]{9}$/

/** Never let internal columns out of this module. */
const toPublicPartner = ({ passwordHash, ...rest }) => rest

/**
 * Partner tokens carry `aud: 'partner'`; staff tokens carry `aud: 'staff'`.
 * A partner token presented on a staff route fails signature verification
 * rather than a role check — structurally incompatible, not merely policed.
 */
const signPartnerToken = (partner) =>
  jwt.sign({ sub: partner.id }, env.jwtSecret, {
    audience: 'partner',
    expiresIn: env.partnerJwtExpiresIn,
  })

/**
 * Proof that THIS number just passed an OTP. Short-lived and bound to the
 * number, so a signup cannot be completed for someone else's mobile.
 */
const signSignupToken = (mobile) =>
  jwt.sign({ mobile }, env.jwtSecret, { audience: 'partner-signup', expiresIn: '15m' })

export function createPartnerAuthService({
  partnerRepository,
  otpRepository,
  mailer,
  sms,
  inviteService,
  partnerReferralService,
  // Injected so tests can drive the compare; production uses bcrypt.
  verifyCode = bcryptVerifyOtp,
  showOtp = env.showOtpInResponse,
}) {
  const badCode = () => ApiError.unauthorized('That code is invalid or has expired')

  const assertMobile = (mobile) => {
    if (!MOBILE.test(mobile ?? '')) {
      throw ApiError.badRequest('Enter a 10-digit mobile number')
    }
  }

  return {
    /**
     * One box, one button. The same call serves signing in and signing up —
     * the partner never has to know which they are doing, and the response
     * says whether we already know this number so the UI can follow up.
     */
    async requestOtp({ mobile }) {
      assertMobile(mobile)
      const partner = await partnerRepository.findByMobile(mobile)
      if (partner?.status === 'SUSPENDED') throw ApiError.forbidden('This account is closed')

      const last = await otpRepository.lastIssuedAt(mobile)
      if (last && Date.now() - new Date(last).getTime() < env.otp.resendCooldownSeconds * 1000) {
        // Silently succeed rather than explain — a resend timer is one more
        // thing to understand, and the previous code still works.
        return { sent: true, registered: Boolean(partner), cooldown: true }
      }

      const code = generateOtp()
      const challenge = await otpRepository.create({
        identifier: mobile,
        channel: 'MOBILE',
        codeHash: await hashOtp(code),
        expiresAt: new Date(Date.now() + env.otp.ttlMinutes * 60 * 1000),
      })

      try {
        await sms.sendOtp({ mobile, code })
      } catch (err) {
        // A code nobody received must not sit there holding the cooldown.
        await otpRepository.remove(challenge.id).catch(() => {})
        console.error('[partner-auth] SMS send failed:', err.message)
        throw ApiError.serviceUnavailable('We could not send the code. Please try again.')
      }

      // Email is a courtesy copy; the SMS is the path that matters.
      if (partner?.email && mailer) {
        await mailer
          .send({
            to: partner.email,
            subject: 'Your sign-in code',
            text: `Your sign-in code is ${code}\n\nIt expires in ${env.otp.ttlMinutes} minutes.`,
          })
          .catch(() => {})
      }

      return {
        sent: true,
        registered: Boolean(partner),
        // TESTING ONLY. Guarded at startup so it cannot be on in production.
        ...(showOtp && { devCode: code }),
      }
    },

    async verifyOtp({ mobile, code }) {
      assertMobile(mobile)
      const challenge = await otpRepository.findActive(mobile)
      if (!challenge) throw badCode()
      if (challenge.attempts >= env.otp.maxAttempts) throw badCode()
      if (!(await verifyCode(code, challenge.codeHash))) {
        await otpRepository.bumpAttempts(challenge.id)
        throw badCode()
      }
      await otpRepository.consume(challenge.id)

      const partner = await partnerRepository.findByMobile(mobile)
      if (!partner) {
        // A verified number we do not know yet: hand back proof so the signup
        // form can finish without asking for the code a second time.
        return { needsSignup: true, signupToken: signSignupToken(mobile), mobile }
      }
      if (partner.status === 'SUSPENDED') throw ApiError.forbidden('This account is closed')
      return { token: signPartnerToken(partner), partner: toPublicPartner(partner) }
    },

    /** Only reachable with a signup token, so the number is already proven. */
    async register({ signupToken, mobile, inviteToken, ...data }) {
      let claimed
      try {
        claimed = jwt.verify(signupToken ?? '', env.jwtSecret, { audience: 'partner-signup' })
      } catch {
        throw ApiError.badRequest('Please verify your mobile number first')
      }
      // Bound to the number that passed the OTP — a token for one mobile can
      // never open an account for another.
      if (claimed.mobile !== mobile) throw ApiError.badRequest('Please verify your mobile number first')

      const existing = await partnerRepository.findByMobile(mobile)
      if (existing) throw ApiError.conflict('This number is already registered')

      let onboardedById = null
      let invite = null
      if (inviteToken && inviteService) {
        invite = await inviteService.peekInvite(inviteToken).catch(() => null)
        onboardedById = invite?.employeeId ?? null
      }

      const partner = await partnerRepository.create({ ...data, mobile, onboardedById })
      if (invite && inviteService) {
        await inviteService.markUsed(invite.id, partner.id)
        // A link raised from an introduction closes that introduction out.
        // Wrapped: the account exists by this point, and failing to tidy up
        // the introduction must never turn a successful signup into an error.
        if (invite.referralId && partnerReferralService) {
          await partnerReferralService.markJoined(invite.referralId, partner.id).catch(() => {})
        }
      }

      return { token: signPartnerToken(partner), partner: toPublicPartner(partner) }
    },
  }
}
