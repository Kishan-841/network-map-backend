import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@isp.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!'

const countAuth = (action) => prisma.systemLog.count({ where: { module: 'Auth', action } })

describe('auth audit events', () => {
  it('logs a successful login with the user snapshot', async () => {
    const before = await countAuth('Login')
    const res = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    expect(res.status).toBe(200)
    await vi.waitFor(async () => expect(await countAuth('Login')).toBe(before + 1))
    const entry = await prisma.systemLog.findFirst({
      where: { module: 'Auth', action: 'Login' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry.userEmail).toBe(ADMIN_EMAIL)
    expect(entry.status).toBe('SUCCESS')
  })

  it('logs a failed login without a userId', async () => {
    const before = await countAuth('FailedLogin')
    const res = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@isp.local', password: 'wrong' })
    expect(res.status).toBe(401)
    await vi.waitFor(async () => expect(await countAuth('FailedLogin')).toBe(before + 1))
    const entry = await prisma.systemLog.findFirst({
      where: { module: 'Auth', action: 'FailedLogin' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry.userId).toBeNull()
    expect(entry.status).toBe('FAILED')
    expect(entry.description).toContain('nobody@isp.local')
  })

  it('logs logout', async () => {
    const token = jwt.sign({ sub: 'test-user', role: 'ADMIN' }, env.jwtSecret, { expiresIn: '1h' })
    const before = await countAuth('Logout')
    const res = await request(createApp())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    await vi.waitFor(async () => expect(await countAuth('Logout')).toBe(before + 1))
  })
})
