import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('GET /api/v1/system-logs', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/v1/system-logs')
    expect(res.status).toBe(401)
  })

  it('rejects MANAGER and SURVEYOR', async () => {
    for (const role of ['MANAGER', 'SURVEYOR']) {
      const res = await request(createApp())
        .get('/api/v1/system-logs')
        .set('Authorization', `Bearer ${tokenFor(role)}`)
      expect(res.status).toBe(403)
    }
  })

  it('returns paginated logs for ADMIN', async () => {
    const res = await request(createApp())
      .get('/api/v1/system-logs?page=1&pageSize=10')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 10 })
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(typeof res.body.data.total).toBe('number')
  })

  it('rejects an invalid status filter', async () => {
    const res = await request(createApp())
      .get('/api/v1/system-logs?status=WHATEVER')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(400)
  })
})
