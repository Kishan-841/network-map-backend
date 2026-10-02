import { Router } from 'express'
import { z } from 'zod'
import { requirePartner } from '../../middleware/partner-auth.js'
import { validateBody } from '../../middleware/validate.js'
import { pushTokenRepository } from './push-token.repository.js'

const token = z.string().trim().regex(/^ExponentPushToken\[.+\]$/, 'Not a push token')
const registerSchema = z.object({ token, platform: z.enum(['android', 'ios']) })
const removeSchema = z.object({ token })

/**
 * The partner's phones. Any signed-in partner may register — approved or
 * not — so that a later "you're approved" can reach someone who is waiting.
 */
export const partnerPushTokenRoutes = Router()
partnerPushTokenRoutes.use(requirePartner)

partnerPushTokenRoutes.post('/push-tokens', validateBody(registerSchema), async (req, res, next) => {
  try {
    await pushTokenRepository.upsert({ partnerId: req.partner.id, ...req.body })
    res.json({ success: true, data: { ok: true } })
  } catch (err) {
    next(err)
  }
})

partnerPushTokenRoutes.delete('/push-tokens', validateBody(removeSchema), async (req, res, next) => {
  try {
    await pushTokenRepository.removeForPartner(req.partner.id, req.body.token)
    res.json({ success: true, data: { ok: true } })
  } catch (err) {
    next(err)
  }
})
