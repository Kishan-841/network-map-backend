import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { ApiError } from '../../lib/api-error.js'

export function toPublicUser(user) {
  const { passwordHash, ...publicUser } = user
  return publicUser
}

export function createAuthService({ userRepository }) {
  return {
    async login({ email, password }) {
      const user = await userRepository.findByEmail(email)
      if (!user || !user.isActive) {
        throw ApiError.unauthorized('Invalid email or password')
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash)
      if (!passwordMatches) {
        throw ApiError.unauthorized('Invalid email or password')
      }

      const token = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
        expiresIn: env.jwtExpiresIn,
      })
      return { token, user: toPublicUser(user) }
    },
  }
}
