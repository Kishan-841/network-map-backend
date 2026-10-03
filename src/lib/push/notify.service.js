import { buildNotification } from './messages.js'

export const CHANNEL_ID = 'lead-updates'

/**
 * Sends one catalogue notification to every phone a partner has registered.
 *
 * Never throws: it runs after a lead's status has already been saved, and a
 * notification problem must not turn a successful change into an error for
 * the person who made it. Everything is logged as [push] instead.
 */
export function createNotifier({ tokenRepository, push, log = console }) {
  return {
    async notifyPartner(partnerId, kind, payload) {
      try {
        const rows = await tokenRepository.listForPartner(partnerId)
        if (!rows.length) return { sent: 0 }
        const n = buildNotification(kind, payload)
        const messages = rows.map(({ token }) => ({ to: token, ...n, channelId: CHANNEL_ID }))
        const tickets = await push.send(messages)

        // A phone that uninstalled the app answers DeviceNotRegistered —
        // stop sending to it. Any other error is temporary; keep the token.
        const dead = tickets
          .map((t, i) => (t?.details?.error === 'DeviceNotRegistered' ? messages[i].to : null))
          .filter(Boolean)
        if (dead.length) await tokenRepository.removeTokens(dead)

        const sent = tickets.filter((t) => t?.status === 'ok').length
        log.log(`[push] sent ${kind} to ${sent} device(s) for partner ${partnerId}`)
        return { sent }
      } catch (err) {
        log.error(`[push] ${kind} for partner ${partnerId} failed:`, err.message)
        return { sent: 0 }
      }
    },
  }
}
