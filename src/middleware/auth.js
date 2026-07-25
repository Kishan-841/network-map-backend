import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from '../lib/api-error.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized())

  try {
    const payload = jwt.verify(token, env.jwtSecret)
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'))
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized())
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden())
  next()
}
