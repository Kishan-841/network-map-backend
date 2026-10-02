import { env } from '../../config/env.js'
import { createConsoleSms } from './console-sms.js'
import { createMsg91Sms } from './msg91-sms.js'

/**
 * One `sendOtp({ mobile, code })` contract, swappable by SMS_DRIVER — the
 * same shape as the mailer. `console` (the default) prints; `msg91` sends
 * for real and costs credit. Nothing that calls sendOtp() has to change.
 */
export function getSms() {
  switch (env.smsDriver) {
    case 'console':
      return createConsoleSms()
    case 'msg91':
      return createMsg91Sms({
        authKey: env.msg91.authKey,
        templateId: env.msg91.otpTemplateId,
        otpVar: env.msg91.otpVar,
      })
    default:
      throw new Error(`Unknown SMS_DRIVER "${env.smsDriver}". Supported: console, msg91.`)
  }
}
