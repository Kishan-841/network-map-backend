import { createPartnerAuthService } from './partner-auth.service.js'
import { partnerAuthRepository, otpRepository } from './partner-auth.repository.js'
import { getMailer } from '../../lib/mailer/index.js'

const service = createPartnerAuthService({
  partnerRepository: partnerAuthRepository,
  otpRepository,
  mailer: getMailer(),
  // Wired in Task 5. Until then an invite token is accepted and ignored:
  // the partner still gets an account, just unattributed.
  inviteService: undefined,
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
      res.status(201).json({ success: true, data: await service.register(req.body) })
    } catch (err) {
      next(err)
    }
  },
  login: handle((req) => service.login(req.body)),
  requestOtp: handle((req) => service.requestOtp(req.body)),
  verifyOtp: handle((req) => service.verifyOtp(req.body)),
  me: handle((req) => {
    const { passwordHash, ...partner } = req.partner
    return partner
  }),
}
