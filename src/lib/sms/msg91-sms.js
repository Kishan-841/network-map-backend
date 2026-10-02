const FLOW_URL = 'https://control.msg91.com/api/v5/flow'
const TIMEOUT_MS = 10_000

/**
 * MSG91 as a plain delivery pipe. We generate, hash and check the code
 * ourselves (partner-auth.service); MSG91 only carries it, through a
 * DLT-approved template whose one variable is the code.
 *
 * Throws on anything but a confirmed send — the caller decides what the
 * partner is told, so provider errors never reach the screen.
 */
export function createMsg91Sms({ authKey, templateId, otpVar = 'otp', fetchImpl = fetch }) {
  return {
    async sendOtp({ mobile, code }) {
      const res = await fetchImpl(FLOW_URL, {
        method: 'POST',
        headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          short_url: '0',
          // Numbers are stored as 10 digits; MSG91 wants the country code.
          recipients: [{ mobiles: `91${mobile}`, [otpVar]: code }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`MSG91 answered HTTP ${res.status}`)
      // MSG91 reports some failures inside a 200, as { type: 'error' }.
      const body = await res.json().catch(() => ({}))
      if (body.type !== 'success') {
        throw new Error(`MSG91 refused the SMS: ${body.message ?? 'no reason given'}`)
      }
      // "success" only means MSG91 took the request — delivery is decided
      // later, and a failure then never reaches us. The request id is how a
      // missing SMS is found in MSG91's logs. Last four digits only; never the code.
      const requestId = body.message
      console.log(`[sms] MSG91 accepted OTP for ******${mobile.slice(-4)} — request id ${requestId}`)
      return { requestId }
    },
  }
}
