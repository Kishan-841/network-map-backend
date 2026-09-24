import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

const stamp = Date.now()
const dom = `bulk-${stamp}.local`
const createdEmails = []

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${dom}` } } })
})

describe('POST /api/v1/users/bulk', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).post('/api/v1/users/bulk').send({})
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    const res = await request(createApp())
      .post('/api/v1/users/bulk')
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`)
      .send({ users: [{ name: 'A', email: `a@${dom}`, password: 'Passw0rd', role: 'SALES_MANAGER' }] })
    expect(res.status).toBe(403)
  })

  it('creates a whole manager → leader → executive tree in one upload', async () => {
    const mgr = `mgr@${dom}`
    const tl = `tl@${dom}`
    const se = `se@${dom}`
    const res = await request(createApp())
      .post('/api/v1/users/bulk')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({
        users: [
          // out of order on purpose — the SE comes before its leader/manager.
          { name: 'Exec One', email: se, password: 'Passw0rd1', role: 'Sales executive', reportsToEmail: tl.toUpperCase() },
          { name: 'Manager One', email: mgr, password: 'Passw0rd1', role: 'Sales manager' },
          { name: 'Leader One', email: tl, password: 'Passw0rd1', role: 'Team leader', reportsToEmail: mgr },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.errors).toEqual([])
    expect(res.body.data.created).toHaveLength(3)

    const rows = await prisma.user.findMany({ where: { email: { in: [mgr, tl, se] } } })
    const byEmail = Object.fromEntries(rows.map((u) => [u.email, u]))
    expect(byEmail[mgr].role).toBe('SALES_MANAGER')
    expect(byEmail[mgr].managerId).toBeNull()
    expect(byEmail[tl].role).toBe('TEAM_LEADER')
    expect(byEmail[tl].managerId).toBe(byEmail[mgr].id)
    expect(byEmail[se].role).toBe('SALES_EXECUTIVE')
    expect(byEmail[se].teamLeaderId).toBe(byEmail[tl].id)
    // The executive inherits its team leader's manager.
    expect(byEmail[se].managerId).toBe(byEmail[mgr].id)
  })

  it('is all-or-nothing: one bad row creates nobody', async () => {
    const good = `good@${dom}`
    const res = await request(createApp())
      .post('/api/v1/users/bulk')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({
        users: [
          { name: 'Good Mgr', email: good, password: 'Passw0rd1', role: 'Sales manager' },
          { name: 'Bad Role', email: `bad@${dom}`, password: 'Passw0rd1', role: 'Wizard' },
          { name: 'Weak Pass', email: `weak@${dom}`, password: 'short', role: 'Sales manager' },
          { name: 'Orphan TL', email: `orphan@${dom}`, password: 'Passw0rd1', role: 'Team leader', reportsToEmail: `nobody@${dom}` },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.created).toEqual([])
    const messages = res.body.data.errors.map((e) => e.message).join(' | ')
    expect(res.body.data.errors.length).toBeGreaterThanOrEqual(3)
    expect(messages).toMatch(/Wizard/)
    expect(messages).toMatch(/Password/)
    expect(messages).toMatch(/not in the file or the system/)
    // Nothing was written.
    const none = await prisma.user.findFirst({ where: { email: good } })
    expect(none).toBeNull()
  })

  it('a wrong reports-to role is rejected (executive pointing at a manager)', async () => {
    const res = await request(createApp())
      .post('/api/v1/users/bulk')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({
        users: [
          { name: 'M', email: `m2@${dom}`, password: 'Passw0rd1', role: 'Sales manager' },
          { name: 'E', email: `e2@${dom}`, password: 'Passw0rd1', role: 'Sales executive', reportsToEmail: `m2@${dom}` },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.created).toEqual([])
    expect(res.body.data.errors.map((e) => e.message).join(' ')).toMatch(/must be a team leader/)
  })

  it('refuses an email that already exists', async () => {
    const dupe = `dupe@${dom}`
    await prisma.user.create({ data: { name: 'Existing', email: dupe, passwordHash: 'x', role: 'SALES_MANAGER' } })
    const res = await request(createApp())
      .post('/api/v1/users/bulk')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({ users: [{ name: 'Dupe', email: dupe, password: 'Passw0rd1', role: 'Sales manager' }] })
    expect(res.status).toBe(200)
    expect(res.body.data.created).toEqual([])
    expect(res.body.data.errors.map((e) => e.message).join(' ')).toMatch(/already exists/)
  })
})
