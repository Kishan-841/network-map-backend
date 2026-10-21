import { describe, it, expect, vi } from 'vitest'
import {
  createOpticalLookup,
  summariseConnection,
  redactConnection,
  ADMIN_ONLY_ONU_FIELDS,
  mapLimit,
  snapshotOf,
  pendingConnection,
} from '../src/lib/olt-optical.js'

const STALE = {"username":"8686692513","onus":[{"onu_id":114922912,"olt_id":181,"olt":"PCMC-Morya-Thergaon-1-1.14","pon_no":3,"onu_no":21,"onu_index":"GPON0/3:21","serial":"GPONcbd306a8","status":"unknown","distance_m":4526,"last_seen":"2026-10-05T14:50:32.208528+00:00","session_ip":"100.64.27.128","rx_dbm":-25.38,"rx_quality":"good","tx_dbm":2.3,"baseline_rx_dbm":-25.94,"usernames":["8686692513"],"customer_ips":["100.64.27.128"],"stale":true,"mapping":"live"}]}
const ONLINE = {"username":"8983453863","onus":[{"onu_id":27398167,"olt_id":182,"olt":"PCMC-Morya-Thergaon-2-1.22","pon_no":3,"onu_no":53,"onu_index":"GPON0/3:53","serial":"VTXX41ADC258","status":"online","distance_m":692,"last_seen":"2026-10-19T06:53:20.407533+00:00","session_ip":"100.64.18.132","rx_dbm":-15.8,"rx_quality":"good","tx_dbm":2.27,"baseline_rx_dbm":-15.8,"usernames":["8983453863"],"customer_ips":["100.64.18.132"],"stale":false,"mapping":"live"}]}
const NOT_LINKED = {"detail":"No ONU mapped to this username"}

const reply = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => body,
})
const make = (fetchImpl, extra = {}) =>
  createOpticalLookup({ fetchImpl, baseUrl: 'https://olt.test/api/', apiKey: 'test-key', ...extra })

describe('lookup + normalise', () => {
  it('drops location and unknown keys from a raw ONU', async () => {
    const raw = { ...JSON.parse(JSON.stringify(ONLINE)) }
    raw.onus[0].location = 'telnet admin/secret'
    raw.onus[0].foo = 'bar'
    const r = await make(vi.fn(async () => reply(200, raw))).lookup('8983453863')
    const text = JSON.stringify(r)
    expect(text).not.toContain('telnet')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('foo')
    expect(text).not.toContain('location')
  })

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
    expect(r).toEqual({ unavailable: true, reason: 'error' })
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
    expect(sum(onu({ rxQuality: null })).weak).toBe(false)
    expect(sum(onu({ rxQuality: null, rxDbm: -20, baselineRxDbm: -12 })).weak).toBe(true)
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
    const o = make(f, { now: () => t, ttlMs: 600000 })
    await o.lookup('u'); t += 599999; await o.lookup('u')
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

describe('rate limiting', () => {
  const RL = { unavailable: true, reason: 'rate_limited' }
  const clock = () => {
    const c = { t: 1000, slept: [] }
    c.now = () => c.t
    c.sleep = async (ms) => { c.slept.push(ms); await null; c.t += ms } // time passes only after concurrent callers have reserved
    return c
  }
  const ok = () => vi.fn(async () => reply(200, ONLINE))

  it('token bucket: burst spent, the next call waits for a token', async () => {
    const c = clock(), f = ok()
    const o = make(f, { now: c.now, sleep: c.sleep, burst: 3, ratePerSec: 1 })
    await Promise.all(['a', 'b', 'c'].map((u) => o.lookup(u)))
    expect(f).toHaveBeenCalledTimes(3)
    expect(c.slept).toEqual([])
    await o.lookup('d')
    expect(f).toHaveBeenCalledTimes(4)
    expect(c.slept).toEqual([1000])
  })

  it('gives up instead of waiting longer than maxWaitMs', async () => {
    const c = clock(), f = ok()
    const o = make(f, { now: c.now, sleep: c.sleep, burst: 1, ratePerSec: 0.01, maxWaitMs: 1000 })
    await o.lookup('a')
    expect(await o.lookup('b')).toEqual(RL)
    expect(f).toHaveBeenCalledTimes(1)
    expect(c.slept).toEqual([])
    expect(summariseConnection(RL).state).toBe('pending')
    expect(summariseConnection({ unavailable: true, reason: 'error' }).state).toBe('unavailable')
  })

  it('429 pauses every lookup for Retry-After seconds', async () => {
    const c = clock()
    const f = vi.fn(async () => reply(429, { detail: 'Rate limit exceeded' }, { 'retry-after': '12' }))
    const o = make(f, { now: c.now, sleep: c.sleep })
    expect(await o.lookup('a')).toEqual(RL)
    c.t += 5000
    expect(await o.lookup('b')).toEqual(RL)
    expect(f).toHaveBeenCalledTimes(1)
    c.t += 8000 // +13 s
    await o.lookup('b')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('429 without a usable header pauses 15 s; a huge one is capped at 120 s', async () => {
    const c = clock()
    const f = vi.fn(async () => reply(429, {}))
    const o = make(f, { now: c.now, sleep: c.sleep })
    await o.lookup('a')
    c.t += 14000
    expect(await o.lookup('b')).toEqual(RL)
    c.t += 2000
    await o.lookup('b')
    expect(f).toHaveBeenCalledTimes(2)

    const g = vi.fn(async () => reply(429, {}, { 'retry-after': '99999' }))
    const p = make(g, { now: c.now, sleep: c.sleep })
    await p.lookup('a')
    c.t += 119000
    expect(await p.lookup('b')).toEqual(RL)
    c.t += 2000
    await p.lookup('b')
    expect(g).toHaveBeenCalledTimes(2)
  })

  it('cache hits and blank usernames use no token', async () => {
    const c = clock(), f = ok()
    const o = make(f, { now: c.now, sleep: c.sleep, burst: 1, ratePerSec: 0.01, maxWaitMs: 1000 })
    const first = await o.lookup('a')
    expect(await o.lookup('a')).toEqual(first)
    expect(await o.lookup('')).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    expect(await o.lookup('b')).toEqual(RL) // bucket still empty: the hit took nothing and gave nothing
  })

  it('concurrent lookups of one username share one request', async () => {
    const f = ok()
    const o = make(f)
    const [x, y] = await Promise.all([o.lookup('u'), o.lookup('u')])
    expect(f).toHaveBeenCalledTimes(1)
    expect(x).toEqual(y)
  })

  it('defaults: 50 at once, the 51st waits 1000 ms', async () => {
    const c = clock(), f = ok()
    const o = make(f, { now: c.now, sleep: c.sleep })
    await Promise.all(Array.from({ length: 51 }, (_, i) => o.lookup(`u${i}`)))
    expect(c.slept).toEqual([1000])
    expect(f).toHaveBeenCalledTimes(51)
  })

  it('concurrent waiters get distinct, increasing waits', async () => {
    const c = clock(), f = ok()
    const o = make(f, { now: c.now, sleep: c.sleep, burst: 1, ratePerSec: 1 })
    await o.lookup('a')
    await Promise.all([o.lookup('b'), o.lookup('c')])
    expect(c.slept).toEqual([1000, 2000])
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('a sleeper that wakes into a 429 pause makes no request', async () => {
    const c = clock()
    let release
    const f = vi.fn(() => new Promise((r) => { release = () => r(reply(429, {}, { 'retry-after': '12' })) }))
    let a
    const sleep = async (ms) => { c.slept.push(ms); c.t += ms; release(); await a }
    const o = make(f, { now: c.now, sleep, burst: 1, ratePerSec: 1 })
    a = o.lookup('a')
    expect(await o.lookup('b')).toEqual(RL)
    expect(await a).toEqual(RL)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('a failed de-duplicated request is retried by the next lookup', async () => {
    const f = vi.fn(async () => reply(500, {}))
    const o = make(f)
    await Promise.all([o.lookup('u'), o.lookup('u')])
    expect(f).toHaveBeenCalledTimes(1)
    await o.lookup('u')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a 429 drains the bucket: after the pause lookups wait for refill', async () => {
    const c = clock()
    let status = 429
    const f = vi.fn(async () => status === 429 ? reply(429, {}, { 'retry-after': '10' }) : reply(200, ONLINE))
    const o = make(f, { now: c.now, sleep: c.sleep, burst: 5, ratePerSec: 1 })
    await o.lookup('a')
    c.t += 10000
    status = 200
    await Promise.all(['x', 'y', 'z'].map((u) => o.lookup(u)))
    expect(c.slept).toEqual([1000, 2000, 3000])
  })

  it('the pause only grows', async () => {
    const c = clock()
    const hdr = ['60', '5']
    const f = vi.fn(async () => reply(429, {}, { 'retry-after': hdr.shift() ?? '5' }))
    const g = vi.fn(async (...a) => f(...a))
    const o = make(g, { now: c.now, sleep: c.sleep })
    await Promise.all([o.lookup('a'), o.lookup('b')]) // both in flight: 60 s then 5 s
    c.t += 6000
    expect(await o.lookup('c')).toEqual(RL)
    expect(g).toHaveBeenCalledTimes(2)
  })

  it('other failures stay plain unavailable and are not cached', async () => {
    const f = vi.fn(async () => reply(500, {}))
    const o = make(f)
    expect((await o.lookup('u')).unavailable).toBe(true)
    await o.lookup('u')
    expect(f).toHaveBeenCalledTimes(2)
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

describe('snapshotOf', () => {
  it('online: copies the best ONU and the weak flag', async () => {
    const c = summariseConnection(await make(async () => reply(200, ONLINE)).lookup('u'))
    expect(snapshotOf(c)).toEqual({
      connState: 'online', connRxDbm: -15.8, connRxQuality: 'good', connOlt: 'PCMC-Morya-Thergaon-2-1.22',
      connPon: 3, connOnu: 53, connLastSeen: new Date('2026-10-19T06:53:20.407533+00:00'), connWeak: false,
    })
  })

  it('not_seen keeps the best ONU too', async () => {
    const c = summariseConnection(await make(async () => reply(200, STALE)).lookup('u'))
    const s = snapshotOf(c)
    expect(s.connState).toBe('not_seen')
    expect(s.connRxDbm).toBe(-25.38)
    expect(s.connLastSeen).toBeInstanceOf(Date)
  })

  it('offline stores state and best ONU', () => {
    const c = summariseConnection({ found: true, onus: [{ status: 'down', stale: false, rxDbm: -20, rxQuality: 'weak', olt: 'O', pon: 1, onu: 2, lastSeen: null, baselineRxDbm: null }] })
    expect(snapshotOf(c)).toMatchObject({ connState: 'offline', connRxDbm: -20, connRxQuality: 'weak', connLastSeen: null, connWeak: false })
  })

  it('not_linked and no_username have null best-derived fields', () => {
    const nulls = { connRxDbm: null, connRxQuality: null, connOlt: null, connPon: null, connOnu: null, connLastSeen: null, connWeak: false }
    expect(snapshotOf(summariseConnection({ found: false }))).toEqual({ connState: 'not_linked', ...nulls })
    expect(snapshotOf(summariseConnection(null))).toEqual({ connState: 'no_username', ...nulls })
  })

  it('unavailable and pending give null (nothing to store)', () => {
    expect(snapshotOf(summariseConnection({ unavailable: true, reason: 'error' }))).toBeNull()
    expect(snapshotOf(summariseConnection({ unavailable: true, reason: 'rate_limited' }))).toBeNull()
    expect(snapshotOf(summariseConnection({ unavailable: true }))).toBeNull()
    expect(snapshotOf(pendingConnection())).toBeNull()
  })
})

describe('isPaused / availableTokens', () => {
  it('reports the 429 pause and the bucket, read-only', async () => {
    let t = 1_000_000
    const o = make(async () => reply(429, {}, { 'retry-after': '10' }), { now: () => t, burst: 5, ratePerSec: 1 })
    expect(o.isPaused()).toBe(false)
    expect(o.availableTokens()).toBe(5)
    expect(o.availableTokens()).toBe(5)
    await o.lookup('u')
    expect(o.isPaused()).toBe(true)
    expect(o.availableTokens()).toBeLessThanOrEqual(0)
    t += 11_000
    expect(o.isPaused()).toBe(false)
  })

  it('tokens drop per request and refill with time', async () => {
    let t = 0
    const o = make(async () => reply(404, {}), { now: () => t, burst: 3, ratePerSec: 1 })
    await o.lookup('a')
    await o.lookup('b')
    expect(o.availableTokens()).toBe(1)
    t += 1000
    expect(o.availableTokens()).toBe(2)
  })
})
