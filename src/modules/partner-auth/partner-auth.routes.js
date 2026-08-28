import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { otpRequestLimiter, partnerLoginLimiter } from '../../middleware/rate-limit.js'
import {
  registerSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
} from './partner-auth.schemas.js'
import { partnerAuthController } from './partner-auth.controller.js'

export const partnerAuthRoutes = Router()

partnerAuthRoutes.post(
  '/register',
  partnerLoginLimiter,
  validateBody(registerSchema),
  partnerAuthController.register,
)
partnerAuthRoutes.post(
  '/login',
  partnerLoginLimiter,
  validateBody(loginSchema),
  partnerAuthController.login,
)
// Tighter than login: this one sends email on our account.
partnerAuthRoutes.post(
  '/otp/request',
  otpRequestLimiter,
  validateBody(otpRequestSchema),
  partnerAuthController.requestOtp,
)
partnerAuthRoutes.post(
  '/otp/verify',
  partnerLoginLimiter,
  validateBody(otpVerifySchema),
  partnerAuthController.verifyOtp,
)
partnerAuthRoutes.get('/me', requirePartner, partnerAuthController.me)
