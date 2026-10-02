/**
 * Development push: prints the notification instead of sending it. The
 * default, so local work and the test suite never touch Expo or Firebase.
 */
export function createConsolePush() {
  return {
    async send(messages) {
      for (const m of messages) {
        console.log(
          `\n┌─ PUSH (console driver) ──────────────────\n` +
            `│ To:    ${m.to}\n│ Title: ${m.title}\n│ Body:  ${m.body}\n│ Data:  ${JSON.stringify(m.data)}\n` +
            `└──────────────────────────────────────────\n`,
        )
      }
      return messages.map(() => ({ status: 'ok', id: 'console' }))
    },
  }
}
