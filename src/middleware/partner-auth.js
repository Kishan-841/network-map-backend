import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from '../lib/api-error.js'
import { partnerAuthRepository } from '../modules/partner-auth/partner-auth.repository.js'

/**
 * Authenticates a PARTNER, never a staff user.
 *
 * The audience check is the whole point: a staff token presented here fails
 * signature verification rather than a role check further in. The two token
 * families cannot be confused for one another by any amount of later
 * carelessness.
 */
export async function requirePartner(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ')
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized())

  let payload
  try {
    payload = jwt.verify(token, env.jwtSecret, { audience: 'partner' })
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'))
  }

  try {
    // Re-read each request so a suspension takes effect immediately rather
    // than lingering until the token expires — same rule as staff auth.
    const partner = await partnerAuthRepository.findById(payload.sub)
    if (!partner || partner.status === 'SUSPENDED') return next(ApiError.unauthorized())
    req.partner = partner
    next()
  } catch (err) {
    next(err)
  }
}
