/**
 * Development mailer: prints the message instead of sending it.
 *
 * This is what keeps the whole OTP flow testable today with no provider
 * account, no API keys and no spend — and it is why dropping mobile OTP took
 * DLT registration off the critical path entirely.
 */
export function createConsoleMailer() {
  return {
    async send({ to, subject, text }) {
      console.log(
        `\n┌─ EMAIL (console mailer) ─────────────────\n` +
          `│ To:      ${to}\n` +
          `│ Subject: ${subject}\n` +
          `├──────────────────────────────────────────\n` +
          `${text}\n` +
          `└──────────────────────────────────────────\n`,
      )
    },
  }
}
