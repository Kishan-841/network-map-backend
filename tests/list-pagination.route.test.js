import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const adminToken = jwt.sign({ sub: 'test-admin', role: 'ADMIN' }, env.jwtSecret, {
  expiresIn: '1h',
})
const get = (url) => request(createApp()).get(url).set('Authorization', `Bearer ${adminToken}`)

describe('dual-response pagination', () => {
  it('GET /users without page returns the legacy array with assignedZones', async () => {
    const res = await get('/api/v1/users')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data[0]).toHaveProperty('assignedZones')
    expect(res.body.data[0]).not.toHaveProperty('passwordHash')
  })

  it('GET /users with page returns the envelope and filters by search + role', async () => {
    const res = await get('/api/v1/users?page=1&pageSize=5&search=admin&role=ADMIN')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 5 })
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(res.body.data.items.every((u) => u.role === 'ADMIN')).toBe(true)
  })

  it('GET /zones without page returns the legacy array', async () => {
    const res = await get('/api/v1/zones')
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('GET /zones with page + search returns matching envelope', async () => {
    const res = await get('/api/v1/zones?page=1&pageSize=5&search=zzz-no-such-zone')
    expect(res.body.data.items).toHaveLength(0)
    expect(res.body.data.total).toBe(0)
  })
})
