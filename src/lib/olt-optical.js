/**
 * Client for the company OLT monitoring API (per-Username ONU status and
 * optical signal). Server-only: the key never reaches the browser.
 *
 * Never reads or returns the API's `location` field (it carries device
 * passwords). Answers are cached in memory per Username; failures are not.
 */
const MAX_CACHE = 5000
const DROP_DB = 3

/** Fields only ADMIN may see; stripped by redactConnection. */
export const ADMIN_ONLY_ONU_FIELDS = ['serial', 'sessionIp', 'customerIps', 'onuIndex', 'onuId', 'oltId']

function normaliseOnu(o) {
  return {
    olt: o.olt ?? null,
    pon: o.pon_no ?? null,
    onu: o.onu_no ?? null,
    status: o.status ?? null,
    stale: o.stale === true,
    lastSeen: o.last_seen ?? null,
    rxDbm: o.rx_dbm ?? null,
    rxQuality: o.rx_quality ?? null,
    txDbm: o.tx_dbm ?? null,
    baselineRxDbm: o.baseline_rx_dbm ?? null,
    distanceM: o.distance_m ?? null,
    serial: o.serial ?? null,
    sessionIp: o.session_ip ?? null,
    customerIps: Array.isArray(o.customer_ips) ? [...o.customer_ips] : [],
    onuIndex: o.onu_index ?? null,
    onuId: o.onu_id ?? null,
    oltId: o.olt_id ?? null,
  }
}

/**
 * @returns {{ enabled: boolean, lookup: (username: string) => Promise<
 *   { found: true, onus: object[] } | { found: false } | { unavailable: true } | null>}}
 * lookup() returns null (and sends no request) for a blank username: deciding
 * "no username" is the caller's job (summariseConnection(null)). When the
 * client is disabled it answers { unavailable: true } without fetching.
 */
export function createOpticalLookup({
  fetchImpl = globalThis.fetch,
  baseUrl,
  apiKey,
  timeoutMs = 8000,
  ttlMs = 300000,
  now = Date.now,
} = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  const enabled = Boolean(base && apiKey)
  const cache = new Map()

  async function lookup(username) {
    const u = String(username ?? '').trim()
    if (!u) return null
    if (!enabled) return { unavailable: true }

    const hit = cache.get(u)
    if (hit && now() - hit.at < ttlMs) return hit.value

    let value
    try {
      const res = await fetchImpl(`${base}/optical?username=${encodeURIComponent(u)}`, {
        headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 404) value = { found: false }
      else if (res.status === 200) {
        const json = await res.json()
        value = { found: true, onus: (Array.isArray(json?.onus) ? json.onus : []).map(normaliseOnu) }
      } else return { unavailable: true }
    } catch {
      return { unavailable: true }
    }

    if (cache.size >= MAX_CACHE) cache.clear()
    cache.set(u, { at: now(), value })
    return value
  }

  return { enabled, lookup }
}

const isOnline = (o) => o.status === 'online' && !o.stale

function pickBest(onus) {
  const rank = (o) => (o.rxDbm == null ? -Infinity : o.rxDbm)
  return [...onus].sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || rank(b) - rank(a))[0] ?? null
}

/** A lookup result (or null = customer has no Username) -> one Connection. */
export function summariseConnection(lookup) {
  const empty = { onus: [], best: null, signalDropped: false, weak: false }
  if (lookup == null) return { state: 'no_username', ...empty }
  if (lookup.unavailable) return { state: 'unavailable', ...empty }
  if (!lookup.found || !lookup.onus?.length) return { state: 'not_linked', ...empty }

  const { onus } = lookup
  const state = onus.some(isOnline) ? 'online' : onus.every((o) => o.stale) ? 'not_seen' : 'offline'
  const best = pickBest(onus)
  const signalDropped =
    best.rxDbm != null && best.baselineRxDbm != null && best.rxDbm <= best.baselineRxDbm - DROP_DB + 1e-9
  const weak = state === 'online' && (best.rxQuality !== 'good' || signalDropped)
  return { state, onus, best, signalDropped, weak }
}

const strip = (onu) => {
  if (!onu) return onu
  const copy = { ...onu }
  for (const k of ADMIN_ONLY_ONU_FIELDS) delete copy[k]
  return copy
}

/** Copy of a Connection without the ADMIN-only fields. */
export function redactConnection(connection) {
  return { ...connection, onus: connection.onus.map(strip), best: strip(connection.best) }
}

/** Like Promise.all(items.map(fn)) but at most `limit` calls in flight; order kept. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker))
  return results
}
