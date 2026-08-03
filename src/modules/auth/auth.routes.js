import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { loginSchema } from './auth.schemas.js'
import { authController } from './auth.controller.js'

export const authRoutes = Router()

authRoutes.post('/login', validateBody(loginSchema), authController.login)
authRoutes.post('/logout', requireAuth, authController.logout)
authRoutes.get('/me', requireAuth, authController.me)
