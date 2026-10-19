import { describe, it, expect, vi } from 'vitest'
import {
  createOpticalLookup,
  summariseConnection,
  redactConnection,
  ADMIN_ONLY_ONU_FIELDS,
  mapLimit,
} from '../src/lib/olt-optical.js'

const STALE = {"username":"8686692513","onus":[{"onu_id":114922912,"olt_id":181,"olt":"PCMC-Morya-Thergaon-1-1.14","pon_no":3,"onu_no":21,"onu_index":"GPON0/3:21","serial":"GPONcbd306a8","status":"unknown","distance_m":4526,"last_seen":"2026-10-05T14:50:32.208528+00:00","session_ip":"100.64.27.128","rx_dbm":-25.38,"rx_quality":"good","tx_dbm":2.3,"baseline_rx_dbm":-25.94,"usernames":["8686692513"],"customer_ips":["100.64.27.128"],"stale":true,"mapping":"live"}]}
const ONLINE = {"username":"8983453863","onus":[{"onu_id":27398167,"olt_id":182,"olt":"PCMC-Morya-Thergaon-2-1.22","pon_no":3,"onu_no":53,"onu_index":"GPON0/3:53","serial":"VTXX41ADC258","status":"online","distance_m":692,"last_seen":"2026-10-19T06:53:20.407533+00:00","session_ip":"100.64.18.132","rx_dbm":-15.8,"rx_quality":"good","tx_dbm":2.27,"baseline_rx_dbm":-15.8,"usernames":["8983453863"],"customer_ips":["100.64.18.132"],"stale":false,"mapping":"live"}]}
const NOT_LINKED = {"detail":"No ONU mapped to this username"}

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const make = (fetchImpl, extra = {}) =>
  createOpticalLookup({ fetchImpl, baseUrl: 'https://olt.test/api/', apiKey: 'test-key', ...extra })

describe('lookup + normalise', () => {
  it('normalises an online customer and sends key + encoded username', async () => {
    const f = vi.fn(async () => reply(200, ONLINE))
    const r = await make(f).lookup('8983453863')
    expect(f).toHaveBeenCalledTimes(1)
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe('https://olt.test/api/optical?username=8983453863')
    expect(opts.headers['X-API-Key']).toBe('test-key')
    expect(r.found).toBe(true)
    expect(r.onus[0]).toEqual({
      olt: 'PCMC-Morya-Thergaon-2-1.22', pon: 3, onu: 53, status: 'online', stale: false,
      lastSeen: '2026-10-19T06:53:20.407533+00:00', rxDbm: -15.8, rxQuality: 'good', txDbm: 2.27,
      baselineRxDbm: -15.8, distanceM: 692, serial: 'VTXX41ADC258', sessionIp: '100.64.18.132',
      customerIps: ['100.64.18.132'], onuIndex: 'GPON0/3:53', onuId: 27398167, oltId: 182,
    })
    expect(summariseConnection(r).state).toBe('online')
  })

  it('encodes odd usernames', async () => {
    const f = vi.fn(async () => reply(404, NOT_LINKED))
    await make(f).lookup('a b&c')
    expect(f.mock.calls[0][0]).toContain('username=a%20b%26c')
  })

  it('stale unknown -> not_seen', async () => {
    const r = await make(async () => reply(200, STALE)).lookup('8686692513')
    expect(summariseConnection(r).state).toBe('not_seen')
  })

  it('404 -> not_linked', async () => {
    const r = await make(async () => reply(404, NOT_LINKED)).lookup('1')
    expect(r).toEqual({ found: false })
    const c = summariseConnection(r)
    expect(c).toEqual({ state: 'not_linked', onus: [], best: null, signalDropped: false, weak: false })
  })

  it.each([
    ['500', async () => reply(500, {})],
    ['403', async () => reply(403, {})],
    ['thrown', async () => { throw new Error('ENOTFOUND') }],
    ['timeout', async () => { throw new DOMException('timed out', 'TimeoutError') }],
  ])('%s -> unavailable', async (_n, impl) => {
    const r = await make(impl).lookup('1')
    expect(r).toEqual({ unavailable: true })
    expect(summariseConnection(r).state).toBe('unavailable')
  })

  it('null lookup -> no_username; blank username sends nothing', async () => {
    expect(summariseConnection(null).state).toBe('no_username')
    const f = vi.fn()
    const o = make(f)
    expect(await o.lookup('')).toBeNull()
    expect(await o.lookup('   ')).toBeNull()
    expect(await o.lookup(null)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('disabled when url or key missing, and never fetches', async () => {
    const f = vi.fn()
    for (const o of [
      createOpticalLookup({ fetchImpl: f, baseUrl: '', apiKey: 'k' }),
      createOpticalLookup({ fetchImpl: f, baseUrl: 'https://x', apiKey: '' }),
    ]) {
      expect(o.enabled).toBe(false)
      expect(await o.lookup('1')).toEqual({ unavailable: true })
    }
    expect(f).not.toHaveBeenCalled()
    expect(make(f).enabled).toBe(true)
  })
})

describe('summariseConnection', () => {
  const onu = (o) => ({ status: 'online', stale: false, rxDbm: -15, rxQuality: 'good', baselineRxDbm: -15, ...o })
  const sum = (...onus) => summariseConnection({ found: true, onus })

  it('signal dropped at exactly baseline-3, not at baseline-2.9', () => {
    expect(sum(onu({ rxDbm: -15, baselineRxDbm: -12 })).signalDropped).toBe(true)
    expect(sum(onu({ rxDbm: -14.9, baselineRxDbm: -12 })).signalDropped).toBe(false)
    expect(sum(onu({ rxDbm: -25.4, baselineRxDbm: -22.4 })).signalDropped).toBe(true)
  })

  it('weak = online and (quality not good or dropped)', () => {
    expect(sum(onu({})).weak).toBe(false)
    expect(sum(onu({ rxQuality: 'poor' })).weak).toBe(true)
    expect(sum(onu({ rxDbm: -20, baselineRxDbm: -12 })).weak).toBe(true)
    expect(sum(onu({ status: 'offline', rxQuality: 'poor' })).weak).toBe(false)
  })

  it('offline: linked, not stale, not online', () => {
    expect(sum(onu({ status: 'offline' })).state).toBe('offline')
  })

  it('best: online first, then highest rx', () => {
    const a = onu({ olt: 'a', status: 'offline', rxDbm: -5 })
    const b = onu({ olt: 'b', rxDbm: -20 })
    const c = onu({ olt: 'c', rxDbm: -10 })
    expect(sum(a, b, c).best.olt).toBe('c')
    expect(sum(a, onu({ olt: 'd', status: 'offline', rxDbm: -3 })).best.olt).toBe('d')
  })

  it('found with no onus -> not_linked', () => {
    expect(sum().state).toBe('not_linked')
  })
})

describe('cache', () => {
  it('hits within ttl, refetches after, never caches unavailable', async () => {
    let t = 1000
    const f = vi.fn(async () => reply(200, ONLINE))
    const o = make(f, { now: () => t, ttlMs: 300000 })
    await o.lookup('u'); t += 299999; await o.lookup('u')
    expect(f).toHaveBeenCalledTimes(1)
    t += 2; await o.lookup('u')
    expect(f).toHaveBeenCalledTimes(2)

    const g = vi.fn(async () => reply(500, {}))
    const p = make(g, { now: () => t })
    await p.lookup('u'); await p.lookup('u')
    expect(g).toHaveBeenCalledTimes(2)
  })

  it('caches not_linked too', async () => {
    const f = vi.fn(async () => reply(404, NOT_LINKED))
    const o = make(f)
    await o.lookup('u'); await o.lookup('u')
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('redactConnection', () => {
  it('removes every admin-only key from onus and best', async () => {
    const c = summariseConnection(await make(async () => reply(200, ONLINE)).lookup('u'))
    expect(Object.keys(c.best)).toEqual(expect.arrayContaining(ADMIN_ONLY_ONU_FIELDS))
    const r = redactConnection(c)
    for (const k of ADMIN_ONLY_ONU_FIELDS) {
      expect(r.best).not.toHaveProperty(k)
      expect(r.onus[0]).not.toHaveProperty(k)
    }
    expect(r.best.rxDbm).toBe(-15.8)
    expect(c.best.serial).toBe('VTXX41ADC258') // original untouched
    expect(redactConnection({ state: 'no_username', onus: [], best: null }).best).toBeNull()
  })
})

describe('mapLimit', () => {
  it('limits concurrency and keeps order', async () => {
    let active = 0, peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 10 - n))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
    expect(peak).toBe(3)
  })
})
