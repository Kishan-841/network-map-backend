import { env } from '../../config/env.js'
import { createConsoleMailer } from './console-mailer.js'

/**
 * One `send({ to, subject, text })` contract, swappable by MAIL_DRIVER.
 *
 * `console` is the development default. A real provider (SES, Resend,
 * Postmark, SMTP) becomes a second implementation of this same interface —
 * and SMS, when it arrives, becomes a third. Nothing that calls send() has
 * to change.
 */
export function getMailer() {
  switch (env.mailDriver) {
    case 'console':
      return createConsoleMailer()
    default:
      throw new Error(
        `Unknown MAIL_DRIVER "${env.mailDriver}". Supported: console.`,
      )
  }
}
