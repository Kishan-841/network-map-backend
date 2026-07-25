import { createAuthService, toPublicUser } from './auth.service.js'
import { userRepository } from '../users/user.repository.js'
import { ApiError } from '../../lib/api-error.js'

const authService = createAuthService({ userRepository })

export const authController = {
  async login(req, res, next) {
    try {
      const result = await authService.login(req.body)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  async me(req, res, next) {
    try {
      const user = await userRepository.findById(req.user.id)
      if (!user || !user.isActive) throw ApiError.unauthorized()
      res.json({ success: true, data: toPublicUser(user) })
    } catch (err) {
      next(err)
    }
  },
}
