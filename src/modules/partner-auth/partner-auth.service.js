import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { ApiError } from '../../lib/api-error.js'
import { env } from '../../config/env.js'
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js'

const BCRYPT_ROUNDS = 10

/** Never let a password hash out of this module. */
const toPublicPartner = ({ passwordHash, ...rest }) => rest

/**
 * Partner tokens carry `aud: 'partner'`. Staff tokens carry `aud: 'staff'`.
 * The two are then structurally incompatible: a partner token does not fail
 * a role check on a staff route, it fails signature verification. That is a
 * far stronger guarantee than a check somebody has to remember to write —
 * which is exactly what drifted in the August audit.
 */
const signPartnerToken = (partner) =>
  jwt.sign({ sub: partner.id }, env.jwtSecret, {
    audience: 'partner',
    expiresIn: env.partnerJwtExpiresIn,
  })

export function createPartnerAuthService({ partnerRepository, otpRepository, mailer, inviteService }) {
  // ONE message for every credential failure. Distinguishing "no such
  // account" from "wrong password" turns the endpoint into a directory of
  // who our partners are.
  const badCredentials = () => ApiError.unauthorized('Invalid email or password')
  const badCode = () => ApiError.unauthorized('That code is invalid or has expired')

  return {
    async register({ inviteToken, password, ...data }) {
      const existing = await partnerRepository.findByEmail(data.email)
      if (existing) throw ApiError.conflict('An account with this email already exists')

      // A bad invite must not block the signup — the partner still gets an
      // account, and an admin maps them to an employee later (spec §3.2).
      let onboardedById = null
      let invite = null
      if (inviteToken && inviteService) {
        invite = await inviteService.peekInvite(inviteToken)
        onboardedById = invite?.employeeId ?? null
      }

      const partner = await partnerRepository.create({
        ...data,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        onboardedById,
      })
      if (invite && inviteService) await inviteService.markUsed(invite.id, partner.id)

      return { token: signPartnerToken(partner), partner: toPublicPartner(partner) }
    },

    async login({ email, password }) {
      const partner = await partnerRepository.findByEmail(email)
      // Compare against a dummy hash when the account is unknown so the
      // response takes the same time either way.
      const hash = partner?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv'
      const ok = await bcrypt.compare(password, hash)
      if (!partner || !ok) throw badCredentials()
      if (partner.status === 'SUSPENDED') throw badCredentials()
      return { token: signPartnerToken(partner), partner: toPublicPartner(partner) }
    },

    /**
     * Always resolves `{ sent: true }` — for a real partner, an unknown
     * address, or a resend inside the cooldown. The caller learns nothing.
     */
    async requestOtp({ email }) {
      const partner = await partnerRepository.findByEmail(email)
      if (!partner || partner.status === 'SUSPENDED') return { sent: true }

      const last = await otpRepository.lastIssuedAt(email)
      if (last && Date.now() - new Date(last).getTime() < env.otp.resendCooldownSeconds * 1000) {
        return { sent: true }
      }

      const code = generateOtp()
      await otpRepository.create({
        identifier: email,
        channel: 'EMAIL',
        codeHash: await hashOtp(code),
        expiresAt: new Date(Date.now() + env.otp.ttlMinutes * 60 * 1000),
      })
      await mailer.send({
        to: email,
        subject: 'Your sign-in code',
        text:
          `Your sign-in code is ${code}\n\n` +
          `It expires in ${env.otp.ttlMinutes} minutes. If you did not ask for it, ignore this email.`,
      })
      return { sent: true }
    },

    async verifyOtp({ email, code }) {
      const challenge = await otpRepository.findActive(email)
      if (!challenge) throw badCode()
      // At the cap the code is dead. Return before counting, so a flood of
      // guesses cannot keep the row alive or inflate the counter forever.
      if (challenge.attempts >= env.otp.maxAttempts) throw badCode()

      if (!(await verifyOtp(code, challenge.codeHash))) {
        await otpRepository.bumpAttempts(challenge.id)
        throw badCode()
      }

      const partner = await partnerRepository.findByEmail(email)
      if (!partner || partner.status === 'SUSPENDED') throw badCode()

      await otpRepository.consume(challenge.id)
      return { token: signPartnerToken(partner), partner: toPublicPartner(partner) }
    },
  }
}
