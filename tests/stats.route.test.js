import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('GET /api/v1/stats/dashboard', () => {
  it('returns the enriched payload for ADMIN (charts included, raw SQL runs)', async () => {
    const res = await request(createApp())
      .get('/api/v1/stats/dashboard')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(typeof d.totalBuildings).toBe('number')
    expect(typeof d.operatorCount).toBe('number')
    expect(typeof d.zoneCount).toBe('number')
    expect(Array.isArray(d.byOperator)).toBe(true)
    expect(Array.isArray(d.overTime)).toBe(true)
    expect(d.byStatus).toHaveProperty('FEASIBLE')
  })

  it('accepts ?operatorId and stays 200', async () => {
    const res = await request(createApp())
      .get('/api/v1/stats/dashboard?operatorId=nonexistent-op')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(200)
    // No buildings under a nonexistent operator.
    expect(res.body.data.totalBuildings).toBe(0)
  })

  it('omits charts for a SURVEYOR', async () => {
    const res = await request(createApp())
      .get('/api/v1/stats/dashboard')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(res.status).toBe(200)
    expect(res.body.data.byOperator).toEqual([])
    expect(res.body.data.overTime).toEqual([])
  })
})
