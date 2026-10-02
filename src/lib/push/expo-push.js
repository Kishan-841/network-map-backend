export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH = 100 // Expo's limit per request
const TIMEOUT_MS = 10_000

/**
 * Expo's push service, which hands each message to Firebase (Android) or
 * Apple (iOS). Returns one ticket per message, in order. A ticket of
 * { status: 'error', details: { error: 'DeviceNotRegistered' } } means that
 * phone no longer has the app — the caller deletes the token.
 */
export function createExpoPush({ fetchImpl = fetch, accessToken } = {}) {
  return {
    async send(messages) {
      const tickets = []
      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages
          .slice(i, i + BATCH)
          .map((m) => ({ ...m, sound: 'default', priority: 'high' }))
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(accessToken && { authorization: `Bearer ${accessToken}` }),
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`Expo push answered HTTP ${res.status}`)
        const body = await res.json()
        tickets.push(...(body.data ?? []))
      }
      return tickets
    },
  }
}
