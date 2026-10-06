import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const app = createApp()
const as = (sub, role) => ({ Authorization: `Bearer ${jwt.sign({ sub, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })

describe('app releases routes', () => {
  it('GET /app-version is public and well-formed', async () => {
    const res = await request(app).get('/api/v1/app-version')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('minimumSupportedVersion')
    expect(res.body.data).toHaveProperty('latestVersion')
    expect(res.body.data).toHaveProperty('apkUrl')
    expect(JSON.stringify(res.body)).not.toContain('apkKey')
  })

  it('admin routes are ADMIN only', async () => {
    expect((await request(app).get('/api/v1/app-releases')).status).toBe(401)
    expect((await request(app).get('/api/v1/app-releases').set(as('test-surveyor', 'SURVEYOR'))).status).toBe(403)
    expect((await request(app).get('/api/v1/app-releases').set(as('test-admin', 'ADMIN'))).status).toBe(200)
  })

  it('refuses a malformed version and a minimum that was never released', async () => {
    const admin = as('test-admin', 'ADMIN')
    expect((await request(app).post('/api/v1/app-releases').set(admin).send({ version: '1.2' })).status).toBe(400)
    expect((await request(app).put('/api/v1/app-releases/minimum').set(admin).send({ minimumSupportedVersion: '987.0.0' })).status).toBe(400)
  })

  it('refuses to register a release whose APK was never uploaded', async () => {
    const res = await request(app).post('/api/v1/app-releases').set(as('test-admin', 'ADMIN')).send({ version: '987.6.5' })
    expect([400, 501]).toContain(res.status) // 400 on R2 (missing object); local driver can't host APKs
  })
})
