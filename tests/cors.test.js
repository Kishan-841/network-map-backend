import { describe, it, expect } from 'vitest'
import { buildCorsOrigin } from '../src/lib/cors-origin.js'

// The cors option's function form is (origin, callback) => callback(err, allow).
const allows = (matcher, origin) =>
  new Promise((resolve) => matcher(origin, (err, ok) => resolve(!err && ok)))

describe('buildCorsOrigin', () => {
  it("returns '*' passthrough in dev", () => {
    expect(buildCorsOrigin('*')).toBe('*')
  })

  it('allows an exact configured origin and rejects others', async () => {
    const m = buildCorsOrigin('https://app.example.com')
    expect(await allows(m, 'https://app.example.com')).toBe(true)
    expect(await allows(m, 'https://evil.example.com')).toBe(false)
  })

  it('allows Vercel preview URLs via a wildcard entry', async () => {
    const m = buildCorsOrigin('https://app-*.vercel.app')
    expect(await allows(m, 'https://app-git-feature-team.vercel.app')).toBe(true)
    expect(await allows(m, 'https://notapp.vercel.app')).toBe(false)
  })

  it('supports a comma list of exact + wildcard entries', async () => {
    const m = buildCorsOrigin('https://app.example.com, https://app-*.vercel.app')
    expect(await allows(m, 'https://app.example.com')).toBe(true)
    expect(await allows(m, 'https://app-preview.vercel.app')).toBe(true)
    expect(await allows(m, 'https://other.com')).toBe(false)
  })

  it('allows requests with no Origin header (curl / server-to-server)', async () => {
    const m = buildCorsOrigin('https://app.example.com')
    expect(await allows(m, undefined)).toBe(true)
  })
})

describe('preflight caching', () => {
  // Every API call carries a bearer token from another origin, so the browser
  // sends an OPTIONS preflight first. Without Access-Control-Max-Age Chrome
  // forgets the answer after 5 s and pays an extra round trip per request.
  it('tells the browser to remember a preflight for 2 hours', async () => {
    const { default: request } = await import('supertest')
    const { createApp } = await import('../src/app.js')
    const res = await request(createApp())
      .options('/api/v1/fibers')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-max-age']).toBe('7200')
  })
})
