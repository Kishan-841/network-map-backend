import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

// ADMIN: surveyors now see only their assigned zones (zone-access feature).
const token = jwt.sign({ sub: 'test-user', role: 'ADMIN' }, env.jwtSecret, { expiresIn: '1h' })

describe('GET /api/v1/zones', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/v1/zones')
    expect(res.status).toBe(401)
  })

  it('returns zones ordered by name', async () => {
    const res = await request(createApp())
      .get('/api/v1/zones')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2)
    const names = res.body.data.map((z) => z.name)
    // Postgres orders with a locale-aware collation (case-insensitive first),
    // so compare the same way — plain JS .sort() is code-unit and diverges on
    // mixed-case names.
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    expect(names).toEqual(sorted)
    expect(res.body.data[0]).toHaveProperty('id')
    expect(res.body.data[0]).toHaveProperty('city')
  })
})
