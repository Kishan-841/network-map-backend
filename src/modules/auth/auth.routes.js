import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { loginLimiter } from '../../middleware/rate-limit.js'
import { loginSchema } from './auth.schemas.js'
import { authController } from './auth.controller.js'

export const authRoutes = Router()

authRoutes.post('/login', loginLimiter, validateBody(loginSchema), authController.login)
authRoutes.post('/logout', requireAuth, authController.logout)
authRoutes.get('/me', requireAuth, authController.me)
