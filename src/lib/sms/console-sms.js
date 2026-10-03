/**
 * Development SMS: prints the message instead of sending it.
 *
 * The default driver, so local work and the test suite never spend SMS
 * credit. Same contract as the MSG91 driver — see ./index.js.
 */
export function createConsoleSms() {
  return {
    async sendOtp({ mobile, code }) {
      console.log(
        `\n┌─ SMS (console driver) ───────────────────\n` +
          `│ To:   ${mobile}\n` +
          `├──────────────────────────────────────────\n` +
          `Your sign-in code is ${code}\n` +
          `└──────────────────────────────────────────\n`,
      )
    },
  }
}
