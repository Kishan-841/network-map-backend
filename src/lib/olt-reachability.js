/**
 * Which OLTs the company monitoring API cannot reach right now (spec
 * 2026-10-21-customers-refresh §1). A customer whose ONU is "not seen" on such
 * an OLT is not known to be down — the monitoring just can't read the OLT.
 *
 * One `GET {base}/olts` per ttl (10 min), shared by concurrent callers. Reads
 * ONLY each row's `name` and `reachable` — never `location` (it holds device
 * passwords; the row is never spread or copied). `reachable === false` is
 * unreachable; true / null / missing are not.
 *
 * A failure keeps the last known set (it is never replaced by an empty one)
 * and is retried after `retryMs`, not on every call. Never fetched → empty set.
 * Feature off (no url/key) → empty set, no request.
 *
 * Stale-while-revalidate: once a set is known, callers get it at once and an
 * expired one is refreshed in the background (one refresh in flight at most).
 * Only the very first fetch is waited for, and only for `firstWaitMs` (3 s);
 * past that the caller gets an empty set and the fetch finishes on its own.
 *
 * `acquire` / `notePause` plug the request into the optical lookup's token
 * bucket, so this call spends the same key budget the lookups do.
 */
export function createOltReachability({
  fetchImpl = globalThis.fetch,
  baseUrl,
  apiKey,
  ttlMs = 600000, // 10 min
  retryMs = 60000,
  timeoutMs = 8000,
  firstWaitMs = 3000,
  now = Date.now,
  acquire = async () => true,
  notePause = () => {},
} = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  const enabled = Boolean(base && apiKey)
  let known = null // Set<string> from the last good answer
  let nextAt = 0 // when the next request may go
  let inflight = null
  let firstAttempt = true

  function namesOf(json) {
    const rows = Array.isArray(json) ? json : Array.isArray(json?.olts) ? json.olts : null
    if (!rows) return null
    const down = new Set()
    for (const row of rows) {
      // Only these two fields are ever touched.
      const name = row?.name
      if (row?.reachable === false && typeof name === 'string' && name) down.add(name)
    }
    return down
  }

  async function refresh() {
    let fresh = null
    try {
      if (await acquire()) {
        const res = await fetchImpl(`${base}/olts`, {
          headers: { 'X-API-Key': apiKey },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.status === 429) notePause(res)
        else if (res.status === 200) fresh = namesOf(await res.json())
      }
    } catch {
      fresh = null
    }
    if (fresh) {
      known = fresh
      nextAt = now() + ttlMs
    } else {
      nextAt = now() + Math.min(retryMs, ttlMs)
    }
  }

  async function unreachableOlts() {
    if (!enabled) return new Set()
    if (now() >= nextAt && !inflight) inflight = refresh().finally(() => { inflight = null })
    if (firstAttempt && inflight) {
      // The very first fetch: wait for it, but never longer than firstWaitMs.
      firstAttempt = false
      let timer
      const cap = new Promise((resolve) => {
        timer = setTimeout(resolve, firstWaitMs)
        timer.unref?.()
      })
      try {
        await Promise.race([inflight, cap])
      } finally {
        clearTimeout(timer)
      }
    }
    return new Set(known ?? [])
  }

  /** Resolves once no refresh is in flight (tests; a graceful shutdown). */
  const whenIdle = () => inflight ?? Promise.resolve()

  return { enabled, unreachableOlts, whenIdle }
}
