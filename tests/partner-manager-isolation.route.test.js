import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * One partner manager must never see another's partners, leads or
 * introductions.
 *
 * These go through the real HTTP layer rather than the services, because the
 * boundary lives in the route: each list spreads the role scope LAST, so a
 * forged query parameter cannot widen it. A refactor that moves that spread
 * earlier would silently open every one of these, which is exactly what these
 * tests exist to catch.
 */
const TAG = `iso-route-${Date.now()}`
const app = createApp()
const tokenFor = (id, role) =>
  jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

const SHUT_OUT = ['SURVEYOR', 'MANAGER', 'SUPERVISOR', 'ACQUISITION_AGENT', 'ACQUISITION_LEAD']

let A, B, pA, pB, lA, lB, iA, iB, tokA, tokB, tokAdmin
/** Real users per role — requireAuth re-reads the user, so a synthetic
 *  subject would be refused 401 and prove nothing about the role check. */
const shutOutTokens = {}

beforeAll(async () => {
  const mkUser = (name, role) =>
    prisma.user.create({
      data: { name, email: `${name}-${TAG}@t.local`, passwordHash: 'x', role, isActive: true },
    })
  A = await mkUser('pm-a', 'PARTNER_MANAGER')
  B = await mkUser('pm-b', 'PARTNER_MANAGER')
  const admin = await mkUser('admin', 'ADMIN')

  const mkPartner = (name, mobile, emp) =>
    prisma.partner.create({
      data: {
        name, type: 'DSA', mobile, email: `${name}-${TAG}@t.local`,
        status: 'APPROVED', onboardedById: emp.id,
      },
    })
  // Mobiles are unique across the table, so keep them out of real-looking space.
  pA = await mkPartner('partner-a', `9${String(Date.now()).slice(-9)}`, A)
  pB = await mkPartner('partner-b', `8${String(Date.now()).slice(-9)}`, B)

  const mkLead = (p, emp, name) =>
    prisma.lead.create({
      data: { partnerId: p.id, employeeId: emp.id, customerName: name, customerMobile: '9800000000' },
    })
  lA = await mkLead(pA, A, `cust-a-${TAG}`)
  lB = await mkLead(pB, B, `cust-b-${TAG}`)

  const mkIntro = (p, emp, name) =>
    prisma.partnerReferral.create({
      data: { referredById: p.id, employeeId: emp.id, name, type: 'DSA', mobile: '9800000001' },
    })
  iA = await mkIntro(pA, A, `intro-a-${TAG}`)
  iB = await mkIntro(pB, B, `intro-b-${TAG}`)

  for (const role of SHUT_OUT) {
    const u = await mkUser(`shut-${role.toLowerCase()}`, role)
    shutOutTokens[role] = tokenFor(u.id, role)
  }

  tokA = tokenFor(A.id, 'PARTNER_MANAGER')
  tokB = tokenFor(B.id, 'PARTNER_MANAGER')
  tokAdmin = tokenFor(admin.id, 'ADMIN')
})

afterAll(async () => {
  const ps = [pA?.id, pB?.id].filter(Boolean)
  await prisma.partnerReferral.deleteMany({ where: { referredById: { in: ps } } })
  await prisma.leadStatusEvent.deleteMany({ where: { lead: { partnerId: { in: ps } } } })
  await prisma.lead.deleteMany({ where: { partnerId: { in: ps } } })
  await prisma.partner.deleteMany({ where: { id: { in: ps } } })
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } })
})

const list = (token, path) =>
  request(app).get(path).set('Authorization', `Bearer ${token}`).then((r) => r.body.data ?? [])
const names = (rows) => rows.map((r) => r.name ?? r.customerName ?? '')
const mentions = (rows, needle) => names(rows).some((n) => n.includes(needle))

describe('partners are private to the manager who recruited them', () => {
  it('B sees their own and not A’s', async () => {
    const rows = await list(tokB, '/api/v1/partners')
    expect(mentions(rows, 'partner-b')).toBe(true)
    expect(mentions(rows, 'partner-a')).toBe(false)
  })

  it('A sees their own and not B’s', async () => {
    const rows = await list(tokA, '/api/v1/partners')
    expect(mentions(rows, 'partner-a')).toBe(true)
    expect(mentions(rows, 'partner-b')).toBe(false)
  })

  it.each([
    '?onboardedById=OTHER',
    '?onboardedById[]=OTHER',
    '?status=APPROVED&onboardedById=OTHER',
    '?onboardedById=',
  ])('a forged %s does not widen the list', async (query) => {
    const rows = await list(tokB, `/api/v1/partners${query.replace('OTHER', A.id)}`)
    expect(mentions(rows, 'partner-a')).toBe(false)
  })

  it('an admin sees both', async () => {
    const rows = await list(tokAdmin, '/api/v1/partners')
    expect(mentions(rows, 'partner-a')).toBe(true)
    expect(mentions(rows, 'partner-b')).toBe(true)
  })

  it('identity documents stay admin-only', async () => {
    const res = await request(app)
      .get(`/api/v1/partners/${pA.id}/documents`)
      .set('Authorization', `Bearer ${tokB}`)
    expect(res.status).toBe(403)
  })
})

describe('leads are private to the manager whose partner sent them', () => {
  it('B sees their own and not A’s', async () => {
    const rows = await list(tokB, '/api/v1/leads')
    expect(mentions(rows, 'cust-b')).toBe(true)
    expect(mentions(rows, 'cust-a')).toBe(false)
  })

  it.each(['?partnerId=PARTNER_A', '?employeeId=USER_A', '?status=NEW', '?employeeId='])(
    'a forged %s does not widen the list',
    async (query) => {
      const path = query.replace('PARTNER_A', pA.id).replace('USER_A', A.id)
      const rows = await list(tokB, `/api/v1/leads${path}`)
      expect(mentions(rows, 'cust-a')).toBe(false)
    },
  )

  it('B cannot move A’s lead, and it stays put', async () => {
    const res = await request(app)
      .patch(`/api/v1/leads/${lA.id}/status`)
      .set('Authorization', `Bearer ${tokB}`)
      .send({ status: 'CONTACTED' })
    expect(res.status).toBe(404)
    const after = await prisma.lead.findUnique({ where: { id: lA.id } })
    expect(after.status).toBe('NEW')
  })

  it('B is told 404, never 403 — A’s lead is not confirmed to exist', async () => {
    const real = await request(app)
      .patch(`/api/v1/leads/${lA.id}/status`)
      .set('Authorization', `Bearer ${tokB}`)
      .send({ status: 'CONTACTED' })
    const imaginary = await request(app)
      .patch('/api/v1/leads/does-not-exist/status')
      .set('Authorization', `Bearer ${tokB}`)
      .send({ status: 'CONTACTED' })
    expect(real.status).toBe(imaginary.status)
    expect(real.body.error.message).toBe(imaginary.body.error.message)
  })

  it('an admin sees both', async () => {
    const rows = await list(tokAdmin, '/api/v1/leads')
    expect(mentions(rows, 'cust-a')).toBe(true)
    expect(mentions(rows, 'cust-b')).toBe(true)
  })
})

describe('introductions follow the same boundary', () => {
  it('B sees their own and not A’s', async () => {
    const rows = await list(tokB, '/api/v1/partner-referrals')
    expect(mentions(rows, 'intro-b')).toBe(true)
    expect(mentions(rows, 'intro-a')).toBe(false)
  })

  it('B cannot move A’s introduction', async () => {
    const res = await request(app)
      .patch(`/api/v1/partner-referrals/${iA.id}/status`)
      .set('Authorization', `Bearer ${tokB}`)
      .send({ status: 'JOINED' })
    expect(res.status).toBe(404)
    expect((await prisma.partnerReferral.findUnique({ where: { id: iA.id } })).status).toBe('NEW')
  })

  it('an admin sees both', async () => {
    const rows = await list(tokAdmin, '/api/v1/partner-referrals')
    expect(mentions(rows, 'intro-a')).toBe(true)
    expect(mentions(rows, 'intro-b')).toBe(true)
  })
})

/**
 * Who may reach the partner network at all.
 *
 * Only the admin and the partner managers. A manager or supervisor oversees
 * the building registry, not other people's customers — and a lead carries a
 * member of the public's name and mobile number, so reaching it needs a
 * reason rather than a senior-sounding role.
 */
describe('the rate card is part of the partner network', () => {
  it('an admin can read it', async () => {
    const res = await request(app)
      .get('/api/v1/rate-card')
      .set('Authorization', `Bearer ${tokAdmin}`)
    expect(res.status).toBe(200)
  })

  it('a partner manager can read it', async () => {
    const res = await request(app).get('/api/v1/rate-card').set('Authorization', `Bearer ${tokA}`)
    expect(res.status).toBe(200)
  })
})

describe('roles with no business here', () => {
  const PATHS = [
    '/api/v1/partners',
    '/api/v1/leads',
    '/api/v1/partner-referrals',
    // The rate card is the commission structure, so it belongs behind the
    // same door as the rest of it.
    '/api/v1/rate-card',
  ]

  for (const role of SHUT_OUT) {
    it.each(PATHS)(`a ${role} is refused %s`, async (path) => {
      const res = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${shutOutTokens[role]}`)
      // 403, not 401: these are real, signed-in, active users. The refusal is
      // about the role, which is what this asserts.
      expect(res.status).toBe(403)
    })
  }

  it.each(SHUT_OUT)('a %s cannot move a lead either', async (role) => {
    const res = await request(app)
      .patch(`/api/v1/leads/${lA.id}/status`)
      .set('Authorization', `Bearer ${shutOutTokens[role]}`)
      .send({ status: 'CONTACTED' })
    expect(res.status).toBe(403)
    expect((await prisma.lead.findUnique({ where: { id: lA.id } })).status).toBe('NEW')
  })

  it('every one of these paths needs a token at all', async () => {
    for (const path of PATHS) {
      expect((await request(app).get(path)).status).toBe(401)
    }
  })
})
