import { snapshotOf, summariseConnection } from './olt-optical.js'

/**
 * Background refresher for the stored connection status on Customer rows.
 * Each tick looks up the least recently checked customers, one at a time (the
 * lookup's token bucket paces them), and saves the answers that say something.
 * Skips quietly when the shared lookup is paused or short on tokens, so user
 * requests keep priority.
 */
export function createOltSync({
  lookup,
  repo,
  summarise = summariseConnection,
  now = Date.now,
  perMinute = 30,
  minTokens = 20,
  backoffMs = 30 * 60 * 1000,
  maxBackoff = 5000,
  log = console,
}) {
  let running = false
  let stopped = false
  let timer = null
  // customerId -> retryAt. A row that gave no snapshot keeps its old
  // connCheckedAt, so without this it would be picked first on every tick.
  const backoff = new Map()

  function holdBack(id) {
    if (!backoff.has(id) && backoff.size >= maxBackoff) backoff.delete(backoff.keys().next().value)
    backoff.set(id, now() + backoffMs)
  }

  async function tick() {
    if (!lookup.enabled) return { checked: 0, saved: 0, skipped: 'disabled' }
    if (running) return { checked: 0, saved: 0, skipped: 'running' }
    if (lookup.isPaused()) return { checked: 0, saved: 0, skipped: 'paused' }
    if (lookup.availableTokens() < minTokens) return { checked: 0, saved: 0, skipped: 'busy' }
    running = true
    try {
      for (const [id, at] of backoff) if (at <= now()) backoff.delete(id)
      // No OLT call, no token: blank-username rows are simply "no username".
      try {
        await repo.markNoUsername?.(200)
      } catch (err) {
        log.error?.('OLT status refresh: marking blank usernames failed:', err?.message)
      }
      const rows = await repo.listForRefresh(perMinute, [...backoff.keys()])
      const entries = []
      let checked = 0
      let notLinked = 0
      let errored = 0
      for (const row of rows) {
        // Give way to building pages that started mid-tick: same floor as the start guard.
        if (stopped || lookup.isPaused() || lookup.availableTokens() < minTokens) break
        const username = String(row.username ?? '').trim()
        if (!username) {
          holdBack(row.id)
          continue
        }
        checked += 1
        try {
          const answer = await lookup.lookup(username)
          if (answer?.unavailable && answer.reason === 'error') errored += 1
          const snapshot = snapshotOf(summarise(answer))
          if (snapshot?.connState === 'not_linked') {
            notLinked += 1
            holdBack(row.id)
          }
          if (snapshot) entries.push({ id: row.id, snapshot })
          else holdBack(row.id)
        } catch (err) {
          holdBack(row.id)
          log.error?.('OLT status refresh: one lookup failed:', err?.message)
        }
      }
      if (checked >= 10 && notLinked === checked) {
        // A misrouted API answers "not linked" for everyone: believe none of it.
        log.warn?.('OLT status refresh: every lookup said "not linked" — check OLT_API_URL')
        return { checked, saved: 0, skipped: null }
      }
      if (checked >= 1 && errored === checked) log.warn?.('OLT status refresh: OLT API unreachable this round')
      if (entries.length) await repo.saveConnectionSnapshots(entries)
      return { checked, saved: entries.length, skipped: null }
    } catch (err) {
      log.error?.('OLT status refresh failed:', err?.message)
      return { checked: 0, saved: 0, skipped: 'error' }
    } finally {
      running = false
    }
  }

  // First tick after 15 s; each next one gap ms after the previous FINISHES,
  // so at most perMinute lookups per gap.
  function schedule(ms, gap) {
    if (stopped) return
    timer = setTimeout(async () => {
      timer = null
      await tick()
      schedule(gap, gap)
    }, ms)
    timer.unref?.()
  }

  function start(intervalMs = 60000) {
    stop()
    stopped = false
    schedule(15000, intervalMs)
  }

  function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { tick, start, stop }
}
