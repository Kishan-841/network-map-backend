import { describe, it, expect } from 'vitest'
import { sanitizeValue } from '../src/modules/system-logs/sanitize.js'

describe('sanitizeValue', () => {
  it('strips password/token/secret keys at any depth', () => {
    const input = {
      name: 'Tower A',
      password: 'x',
      passwordHash: 'y',
      nested: { accessToken: 'z', keep: 1 },
      list: [{ refresh_token: 'r', ok: true }],
      apiSecret: 's',
    }
    expect(sanitizeValue(input)).toEqual({
      name: 'Tower A',
      nested: { keep: 1 },
      list: [{ ok: true }],
    })
  })

  it('returns null for null/undefined', () => {
    expect(sanitizeValue(null)).toBeNull()
    expect(sanitizeValue(undefined)).toBeNull()
  })

  it('makes Dates and other rich values JSON-safe', () => {
    const out = sanitizeValue({ createdAt: new Date('2026-08-03T00:00:00.000Z') })
    expect(out).toEqual({ createdAt: '2026-08-03T00:00:00.000Z' })
  })
})
