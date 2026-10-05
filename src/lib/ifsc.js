import { ApiError } from './api-error.js'
import { IFSC_PATTERN } from '../modules/partners/bank-account.schemas.js'

const MAX_CACHE = 2000

/**
 * Bank and branch for an IFSC, from Razorpay's free public IFSC API (no key).
 * A convenience for the form: callers must never require it to succeed.
 * Found codes are cached — branch data changes about never.
 */
export function createIfscLookup({ fetchImpl = globalThis.fetch, timeoutMs = 5000, base = 'https://ifsc.razorpay.com' } = {}) {
  const cache = new Map()
  return async function lookup(code) {
    const ifsc = String(code ?? '').trim().toUpperCase()
    if (!IFSC_PATTERN.test(ifsc)) throw ApiError.badRequest('Enter a valid IFSC code, like HDFC0001234')
    if (cache.has(ifsc)) return cache.get(ifsc)

    let res
    try {
      res = await fetchImpl(`${base}/${ifsc}`, { signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw ApiError.serviceUnavailable('Could not look up this IFSC right now')
    }
    if (res.status === 404) throw ApiError.notFound('We could not find this IFSC code')
    if (!res.ok) throw ApiError.serviceUnavailable('Could not look up this IFSC right now')

    const json = await res.json()
    const found = { ifsc, bank: json.BANK ?? null, branch: json.BRANCH ?? null, city: json.CITY ?? null }
    if (cache.size >= MAX_CACHE) cache.clear()
    cache.set(ifsc, found)
    return found
  }
}
