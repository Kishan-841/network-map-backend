import { describe, it, expect, vi } from 'vitest'
import { createOltSync } from '../src/lib/olt-sync.js'

const online = { found: true, onus: [{ status: 'online', stale: false, rxDbm: -20, rxQuality: 'good' }] }

function make({ rows = [], enabled = true, paused = false, tokens = 60, answer = () => online } = {}) {
  const state = { paused }
  const lookup = {
    enabled,
    isPaused: () => state.paused,
    availableTokens: () => (typeof tokens === 'function' ? tokens() : tokens),
    lookup: vi.fn(async (u) => answer(u, state)),
  }
  const repo = {
    listForRefresh: vi.fn(async (n, ex = []) => rows.filter((r) => !ex.includes(r.id)).slice(0, n)),
    saveConnectionSnapshots: vi.fn(async () => []),
    markNoUsername: vi.fn(async () => 0),
  }
  const log = { error: vi.fn(), warn: vi.fn() }
  return { state, lookup, repo, log, sync: createOltSync({ lookup, repo, log }) }
}
const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, username: `u${i}` }))

describe('olt sync tick', () => {
  it('skips when disabled, paused or busy, touching nothing', async () => {
    for (const [opts, why] of [[{ enabled: false }, 'disabled'], [{ paused: true }, 'paused'], [{ tokens: 5 }, 'busy']]) {
      const t = make({ rows: mkRows(3), ...opts })
      expect(await t.sync.tick()).toMatchObject({ checked: 0, skipped: why })
      expect(t.repo.listForRefresh).not.toHaveBeenCalled()
    }
  })

  it('checks at most perMinute rows and saves them in one call', async () => {
    const t = make({ rows: mkRows(50) })
    const r = await t.sync.tick()
    expect(r).toEqual({ checked: 30, saved: 30, skipped: null })
    expect(t.repo.listForRefresh).toHaveBeenCalledWith(30, [])
    expect(t.repo.saveConnectionSnapshots).toHaveBeenCalledTimes(1)
    expect(t.repo.saveConnectionSnapshots.mock.calls[0][0][0]).toMatchObject({ id: 'c0', snapshot: { connState: 'online' } })
  })

  it('saves only answers that say something (not unavailable / rate limited)', async () => {
    const t = make({
      rows: mkRows(3),
      answer: (u) => (u === 'u0' ? { unavailable: true } : u === 'u1' ? { unavailable: true, reason: 'rate_limited' } : online),
    })
    expect(await t.sync.tick()).toMatchObject({ checked: 3, saved: 1 })
    expect(t.repo.saveConnectionSnapshots.mock.calls[0][0].map((e) => e.id)).toEqual(['c2'])
  })

  it('a throwing lookup does not stop the others', async () => {
    const t = make({ rows: mkRows(3), answer: (u) => { if (u === 'u1') throw new Error('boom'); return online } })
    expect(await t.sync.tick()).toMatchObject({ checked: 3, saved: 2 })
    expect(t.log.error).toHaveBeenCalled()
  })

  it('stops when the lookup becomes paused mid-tick, keeping what it has', async () => {
    const t = make({ rows: mkRows(5), answer: (u, s) => { if (u === 'u1') s.paused = true; return online } })
    expect(await t.sync.tick()).toMatchObject({ checked: 2, saved: 2 })
    expect(t.repo.saveConnectionSnapshots.mock.calls[0][0]).toHaveLength(2)
  })

  it('never overlaps a running tick', async () => {
    let release
    const t = make({ rows: mkRows(1), answer: () => new Promise((r) => { release = () => r(online) }) })
    const first = t.sync.tick()
    await Promise.resolve(); await Promise.resolve()
    expect(await t.sync.tick()).toMatchObject({ checked: 0, skipped: 'running' })
    release()
    expect(await first).toMatchObject({ checked: 1 })
    expect(t.repo.listForRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('olt sync safety rails', () => {
  it('stops mid-tick when tokens fall below the floor, saving what it has', async () => {
    let tokens = 60
    const t = make({ rows: mkRows(5), tokens: () => tokens, answer: () => { tokens = 5; return online } })
    expect(await t.sync.tick()).toMatchObject({ checked: 1, saved: 1 })
    expect(t.repo.saveConnectionSnapshots.mock.calls[0][0]).toHaveLength(1)
  })

  it('marks blank usernames without any OLT lookup', async () => {
    const t = make({ rows: [] })
    await t.sync.tick()
    expect(t.repo.markNoUsername).toHaveBeenCalledWith(200)
    expect(t.lookup.lookup).not.toHaveBeenCalled()
  })

  it('saves nothing and warns when 10+ lookups all say "not linked"', async () => {
    const t = make({ rows: mkRows(12), answer: () => ({ found: false }) })
    expect(await t.sync.tick()).toMatchObject({ checked: 12, saved: 0 })
    expect(t.repo.saveConnectionSnapshots).not.toHaveBeenCalled()
    expect(t.log.warn).toHaveBeenCalledWith('OLT status refresh: every lookup said "not linked" — check OLT_API_URL')
  })

  it('fewer than 10 "not linked" answers are believed', async () => {
    const t = make({ rows: mkRows(9), answer: () => ({ found: false }) })
    expect(await t.sync.tick()).toMatchObject({ checked: 9, saved: 9 })
    expect(t.log.warn).not.toHaveBeenCalled()
  })

  it('10+ lookups with some linked rows still save', async () => {
    const t = make({ rows: mkRows(12), answer: (u) => (u === 'u0' ? online : { found: false }) })
    expect(await t.sync.tick()).toMatchObject({ checked: 12, saved: 12 })
  })

  it('warns once when every lookup was an error', async () => {
    const t = make({ rows: mkRows(3), answer: () => ({ unavailable: true, reason: 'error' }) })
    expect(await t.sync.tick()).toMatchObject({ checked: 3, saved: 0 })
    expect(t.log.warn).toHaveBeenCalledTimes(1)
    expect(t.log.warn).toHaveBeenCalledWith('OLT status refresh: OLT API unreachable this round')
  })

  it('does not warn when only some lookups errored', async () => {
    const t = make({ rows: mkRows(3), answer: (u) => (u === 'u0' ? { unavailable: true, reason: 'error' } : online) })
    await t.sync.tick()
    expect(t.log.warn).not.toHaveBeenCalled()
  })
})

describe('olt sync backoff and scheduling', () => {
  it('rows that give no snapshot or throw are excluded next tick, so others get checked', async () => {
    const bad = (u) => u === 'u0' || u === 'u1'
    const t = make({
      rows: mkRows(4),
      answer: (u) => { if (u === 'u0') throw new Error('x'); return bad(u) ? { unavailable: true } : online },
    })
    const sync = createOltSync({ lookup: t.lookup, repo: t.repo, perMinute: 2, log: t.log })
    expect(await sync.tick()).toMatchObject({ checked: 2, saved: 0 })
    expect(await sync.tick()).toMatchObject({ checked: 2, saved: 2 })
    expect(t.repo.listForRefresh.mock.calls[1][1].sort()).toEqual(['c0', 'c1'])
  })

  it('backoff expires after the delay', async () => {
    let clock = 0
    const t = make({ rows: mkRows(1), answer: () => ({ unavailable: true }) })
    const sync = createOltSync({ lookup: t.lookup, repo: t.repo, now: () => clock, log: t.log })
    await sync.tick()
    await sync.tick()
    expect(t.lookup.lookup).toHaveBeenCalledTimes(1)
    clock = 31 * 60 * 1000
    await sync.tick()
    expect(t.lookup.lookup).toHaveBeenCalledTimes(2)
  })

  it('never looks up a whitespace-only username', async () => {
    const t = make({ rows: [{ id: 'w', username: '   ' }, { id: 'ok', username: ' u ' }] })
    expect(await t.sync.tick()).toMatchObject({ checked: 1, saved: 1 })
    expect(t.lookup.lookup).toHaveBeenCalledWith('u')
  })

  it('stop() during a running tick halts between rows and no further tick is scheduled', async () => {
    vi.useFakeTimers()
    try {
      const t = make({ rows: mkRows(5), answer: (u) => { if (u === 'u1') t.sync.stop(); return online } })
      t.sync.start(60000)
      await vi.advanceTimersByTimeAsync(15000)
      expect(t.lookup.lookup).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(300000)
      expect(t.repo.listForRefresh).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('next tick is a gap after the previous finishes', async () => {
    vi.useFakeTimers()
    try {
      const t = make({ rows: mkRows(1) })
      t.sync.start(60000)
      await vi.advanceTimersByTimeAsync(15000)
      expect(t.repo.listForRefresh).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(59000)
      expect(t.repo.listForRefresh).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(t.repo.listForRefresh).toHaveBeenCalledTimes(2)
      t.sync.stop()
    } finally { vi.useRealTimers() }
  })
})

describe('olt sync start/stop', () => {
  it('first tick after 15s, then every interval; stop clears both', async () => {
    vi.useFakeTimers()
    try {
      const t = make({ rows: mkRows(1) })
      t.sync.start(60000)
      await vi.advanceTimersByTimeAsync(14000)
      expect(t.repo.listForRefresh).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1500)
      expect(t.repo.listForRefresh).toHaveBeenCalledTimes(1)
      t.sync.stop()
      await vi.advanceTimersByTimeAsync(180000)
      expect(t.repo.listForRefresh).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('createApp() starts no sync and never reads the repo', async () => {
    const { customerRepository } = await import('../src/modules/customers/customer.repository.js')
    const spy = vi.spyOn(customerRepository, 'listForRefresh')
    vi.useFakeTimers()
    try {
      const { createApp } = await import('../src/app.js')
      createApp()
      await vi.advanceTimersByTimeAsync(120000)
      expect(spy).not.toHaveBeenCalled()
    } finally { vi.useRealTimers(); spy.mockRestore() }
  })
})
