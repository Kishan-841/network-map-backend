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
  perMinute = 30,
  minTokens = 20,
  log = console,
}) {
  let running = false
  let interval = null
  let first = null

  async function tick() {
    if (!lookup.enabled) return { checked: 0, saved: 0, skipped: 'disabled' }
    if (running) return { checked: 0, saved: 0, skipped: 'running' }
    if (lookup.isPaused()) return { checked: 0, saved: 0, skipped: 'paused' }
    if (lookup.availableTokens() < minTokens) return { checked: 0, saved: 0, skipped: 'busy' }
    running = true
    try {
      const rows = await repo.listForRefresh(perMinute)
      const entries = []
      let checked = 0
      for (const row of rows) {
        if (lookup.isPaused()) break
        checked += 1
        try {
          const snapshot = snapshotOf(summarise(await lookup.lookup(row.username)))
          if (snapshot) entries.push({ id: row.id, snapshot })
        } catch (err) {
          log.error?.('OLT status refresh: one lookup failed:', err?.message)
        }
      }
      if (entries.length) await repo.saveConnectionSnapshots(entries)
      return { checked, saved: entries.length, skipped: null }
    } catch (err) {
      log.error?.('OLT status refresh failed:', err?.message)
      return { checked: 0, saved: 0, skipped: 'error' }
    } finally {
      running = false
    }
  }

  function start(intervalMs = 60000) {
    stop()
    first = setTimeout(() => {
      first = null
      tick()
    }, 15000)
    first.unref?.()
    interval = setInterval(tick, intervalMs)
    interval.unref?.()
  }

  function stop() {
    if (first) clearTimeout(first)
    if (interval) clearInterval(interval)
    first = interval = null
  }

  return { tick, start, stop }
}
