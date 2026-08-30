import { describe, it, expect, afterEach } from 'vitest'
import { inviteBaseUrl } from '../src/modules/partner-invites/invite.routes.js'

/**
 * The invite URL carries a live token and is forwarded by an employee to an
 * outsider. Its base must come from configuration, never from a header an
 * attacker could shape — flagged by security review 2026-08-28.
 */
const req = (origin) => ({ get: (h) => (h.toLowerCase() === 'origin' ? origin : undefined) })
const original = process.env.WEB_URL
afterEach(() => {
  if (original === undefined) delete process.env.WEB_URL
  else process.env.WEB_URL = original
})

describe('in production', () => {
  it('ignores the Origin header entirely', () => {
    delete process.env.WEB_URL
    const out = inviteBaseUrl(req('https://evil.example'), { nodeEnv: 'production' })
    expect(out).not.toContain('evil.example')
  })

  it('uses WEB_URL even when a hostile Origin is present', () => {
    process.env.WEB_URL = 'https://app.real.com'
    expect(inviteBaseUrl(req('https://evil.example'), { nodeEnv: 'production' })).toBe(
      'https://app.real.com',
    )
  })
})

describe('outside production', () => {
  it('rejects a routable origin — an attacker domain is not loopback', () => {
    delete process.env.WEB_URL
    for (const origin of [
      'https://evil.example',
      'http://localhost.evil.example',
      'https://127.0.0.1.evil.example',
      'http://evil.example:3000',
    ]) {
      expect(inviteBaseUrl(req(origin), { nodeEnv: 'development' })).not.toContain('evil')
    }
  })

  it('accepts a loopback origin, so any dev port works', () => {
    delete process.env.WEB_URL
    for (const origin of ['http://localhost:3000', 'http://localhost:3477', 'http://127.0.0.1:3001']) {
      expect(inviteBaseUrl(req(origin), { nodeEnv: 'development' })).toBe(origin)
    }
  })

  it('still lets WEB_URL win', () => {
    process.env.WEB_URL = 'https://app.real.com'
    expect(inviteBaseUrl(req('http://localhost:3000'), { nodeEnv: 'development' })).toBe(
      'https://app.real.com',
    )
  })

  it('falls back to config when there is no Origin at all', () => {
    delete process.env.WEB_URL
    expect(inviteBaseUrl(req(undefined), { nodeEnv: 'development' })).toMatch(/^https?:\/\//)
  })
})
