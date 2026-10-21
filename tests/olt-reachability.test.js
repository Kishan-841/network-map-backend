import { describe, it, expect, vi } from 'vitest'
import { createOltReachability } from '../src/lib/olt-reachability.js'

const reply = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => body,
})
// The real /olts rows carry device passwords in `location`.
const OLTS = [
  { id: 181, name: 'PCMC-Morya-Thergaon-1-1.14', reachable: false, location: 'telnet admin/SECRET-PW' },
  { id: 182, name: 'PCMC-Morya-Thergaon-2-1.22', reachable: true, location: 'telnet admin/SECRET-PW' },
  { id: 183, name: 'Unknown-1', reachable: null, location: 'SECRET-PW' },
  { id: 184, name: 'NoFlag-1', location: 'SECRET-PW' },
]
const make = (fetchImpl, extra = {}) =>
  createOltReachability({ fetchImpl, baseUrl: 'https://olt.test/api/', apiKey: 'test-key', ...extra })

describe('createOltReachability', () => {
  it('reachable === false is unreachable; null / true / missing are not', async () => {
    const f = vi.fn(async () => reply(200, OLTS))
    const set = await make(f).unreachableOlts()
    expect([...set]).toEqual(['PCMC-Morya-Thergaon-1-1.14'])
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe('https://olt.test/api/olts')
    expect(opts.headers['X-API-Key']).toBe('test-key')
  })

  it('accepts { olts: [...] } too', async () => {
    const set = await make(async () => reply(200, { olts: OLTS })).unreachableOlts()
    expect([...set]).toEqual(['PCMC-Morya-Thergaon-1-1.14'])
  })

  it('never reads location: it is in no output', async () => {
    const rows = OLTS.map((o) => {
      const copy = { ...o }
      // A getter would show any read of the field.
      Object.defineProperty(copy, 'location', { get: () => { throw new Error('location read') }, enumerable: true })
      return copy
    })
    const set = await make(async () => reply(200, rows)).unreachableOlts()
    expect(JSON.stringify([...set])).not.toContain('SECRET')
    expect([...set]).toEqual(['PCMC-Morya-Thergaon-1-1.14'])
  })

  it('one request per ttl; refetches after', async () => {
    let t = 1000
    const f = vi.fn(async () => reply(200, OLTS))
    const r = make(f, { now: () => t, ttlMs: 600000 })
    await r.unreachableOlts()
    t += 599999
    await r.unreachableOlts()
    expect(f).toHaveBeenCalledTimes(1)
    t += 2
    await r.unreachableOlts()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('concurrent callers share one request', async () => {
    const f = vi.fn(async () => reply(200, OLTS))
    const r = make(f)
    await Promise.all([r.unreachableOlts(), r.unreachableOlts(), r.unreachableOlts()])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('a failure keeps the last known set (never replaced by empty)', async () => {
    let t = 1000
    let mode = 'ok'
    const f = vi.fn(async () => {
      if (mode === 'throw') throw new Error('ENOTFOUND')
      if (mode === '500') return reply(500, {})
      if (mode === 'junk') return reply(200, { detail: 'nope' })
      return reply(200, OLTS)
    })
    const r = make(f, { now: () => t, ttlMs: 1000 })
    expect([...(await r.unreachableOlts())]).toEqual(['PCMC-Morya-Thergaon-1-1.14'])
    for (const m of ['throw', '500', 'junk']) {
      mode = m
      t += 120000 // past the ttl and any retry delay
      expect([...(await r.unreachableOlts())]).toEqual(['PCMC-Morya-Thergaon-1-1.14'])
    }
    expect(f).toHaveBeenCalledTimes(4)
  })

  it('never fetched successfully → empty set; a failure is retried after a short delay, not every call', async () => {
    let t = 1000
    const f = vi.fn(async () => reply(503, {}))
    const r = make(f, { now: () => t, retryMs: 60000 })
    expect((await r.unreachableOlts()).size).toBe(0)
    await r.unreachableOlts()
    expect(f).toHaveBeenCalledTimes(1)
    t += 60001
    await r.unreachableOlts()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('feature off → empty set, no request', async () => {
    const f = vi.fn()
    const r = createOltReachability({ fetchImpl: f, baseUrl: '', apiKey: '' })
    expect((await r.unreachableOlts()).size).toBe(0)
    expect(f).not.toHaveBeenCalled()
  })

  it('goes through the shared budget: no token → no request; a 429 is reported', async () => {
    const f = vi.fn(async () => reply(429, {}, { 'retry-after': '20' }))
    const notePause = vi.fn()
    const denied = make(f, { acquire: async () => false, notePause })
    expect((await denied.unreachableOlts()).size).toBe(0)
    expect(f).not.toHaveBeenCalled()
    const r = make(f, { acquire: async () => true, notePause })
    expect((await r.unreachableOlts()).size).toBe(0)
    expect(f).toHaveBeenCalledTimes(1)
    expect(notePause).toHaveBeenCalledTimes(1)
    expect(notePause.mock.calls[0][0].status).toBe(429)
  })

  it('the caller cannot change the cached set', async () => {
    const r = make(async () => reply(200, OLTS))
    const a = await r.unreachableOlts()
    a.add('x')
    expect([...(await r.unreachableOlts())]).toEqual(['PCMC-Morya-Thergaon-1-1.14'])
  })
})
