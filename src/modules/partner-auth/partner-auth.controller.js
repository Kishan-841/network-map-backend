import { createPartnerAuthService } from './partner-auth.service.js'
import { partnerAuthRepository, otpRepository } from './partner-auth.repository.js'
import { getMailer } from '../../lib/mailer/index.js'
import { inviteService } from '../partner-invites/invite.service.js'
import { createPartnerReferralService } from '../partner-referrals/partner-referral.service.js'
import { partnerReferralRepository } from '../partner-referrals/partner-referral.repository.js'

const partnerReferralService = createPartnerReferralService({
  partnerReferralRepository,
  partnerRepository: partnerAuthRepository,
  inviteService,
})

const service = createPartnerAuthService({
  partnerRepository: partnerAuthRepository,
  otpRepository,
  mailer: getMailer(),
  inviteService,
  partnerReferralService,
})

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) })
  } catch (err) {
    next(err)
  }
}

export const partnerAuthController = {
  register: async (req, res, next) => {
    try {
      const body = { ...req.body, email: req.body.email || undefined }
      res.status(201).json({ success: true, data: await service.register(body) })
    } catch (err) {
      next(err)
    }
  },
  requestOtp: handle((req) => service.requestOtp(req.body)),
  verifyOtp: handle((req) => service.verifyOtp(req.body)),
  me: handle((req) => {
    const { passwordHash, ...partner } = req.partner
    return partner
  }),
}
