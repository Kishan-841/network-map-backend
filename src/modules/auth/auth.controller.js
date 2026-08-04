import { createAuthService, toPublicUser } from './auth.service.js'
import { userRepository } from '../users/user.repository.js'
import { ApiError } from '../../lib/api-error.js'
import { systemLogService } from '../system-logs/system-log.service.js'
import { parseRequestInfo } from '../system-logs/request-info.js'

const authService = createAuthService({ userRepository })

// Auth events can't use the audit middleware — the user isn't known until
// login resolves — so they log explicitly. recordLog is fire-and-forget.
export const authController = {
  async login(req, res, next) {
    const base = {
      module: 'Auth',
      requestUrl: req.originalUrl,
      httpMethod: req.method,
      ...parseRequestInfo(req),
    }
    try {
      const result = await authService.login(req.body)
      systemLogService.recordLog({
        ...base,
        userId: result.user.id,
        userName: result.user.name,
        userEmail: result.user.email,
        userRole: result.user.role,
        action: 'Login',
        description: `${result.user.name} logged in`,
        status: 'SUCCESS',
        statusCode: 200,
      })
      res.json({ success: true, data: result })
    } catch (err) {
      systemLogService.recordLog({
        ...base,
        userId: null,
        action: 'FailedLogin',
        description: `Failed login attempt for '${req.body?.email ?? 'unknown'}'`,
        newValue: { email: req.body?.email ?? null },
        status: 'FAILED',
        statusCode: err.status ?? 500,
        errorMessage: err.message,
      })
      next(err)
    }
  },

  async logout(req, res) {
    systemLogService.recordLog({
      module: 'Auth',
      requestUrl: req.originalUrl,
      httpMethod: req.method,
      ...parseRequestInfo(req),
      userId: req.user.id,
      action: 'Logout',
      description: 'User logged out',
      status: 'SUCCESS',
      statusCode: 200,
    })
    res.json({ success: true, data: { loggedOut: true } })
  },

  async me(req, res, next) {
    try {
      const user = await userRepository.findById(req.user.id)
      if (!user || !user.isActive) throw ApiError.unauthorized()
      const assignedZoneIds =
        user.role === 'SURVEYOR' ? await userRepository.assignedZoneIds(user.id) : []
      res.json({ success: true, data: { ...toPublicUser(user), assignedZoneIds } })
    } catch (err) {
      next(err)
    }
  },
}
