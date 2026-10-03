import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { requirePartner } from '../../middleware/partner-auth.js'
import { otpRequestLimiter, partnerLoginLimiter } from '../../middleware/rate-limit.js'
import { otpRequestSchema, otpVerifySchema, registerSchema, updateMeSchema } from './partner-auth.schemas.js'
import { partnerAuthController } from './partner-auth.controller.js'

export const partnerAuthRoutes = Router()

/**
 * One box, one button. The same two calls serve signing in and signing up —
 * the partner never has to know which they are doing.
 */
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
partnerAuthRoutes.post(
  '/register',
  partnerLoginLimiter,
  validateBody(registerSchema),
  partnerAuthController.register,
)
partnerAuthRoutes.get('/me', requirePartner, partnerAuthController.me)
// The partner app saves the chosen language here, so it follows them to a new phone.
partnerAuthRoutes.patch('/me', requirePartner, validateBody(updateMeSchema), partnerAuthController.updateMe)
