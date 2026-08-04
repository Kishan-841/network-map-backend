import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from '../lib/api-error.js'
import { userRepository } from '../modules/users/user.repository.js'

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized())

  let payload
  try {
    payload = jwt.verify(token, env.jwtSecret)
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'))
  }

  try {
    // Re-read the user each request so deactivation and role changes take
    // effect immediately instead of lingering until the token expires.
    const user = await userRepository.findById(payload.sub)
    if (!user || !user.isActive) return next(ApiError.unauthorized())
    req.user = { id: user.id, role: user.role }
    next()
  } catch (err) {
    next(err)
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized())
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden())
  next()
}
