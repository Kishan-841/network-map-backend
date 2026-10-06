import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * A sales manager runs the partner network alongside the partner managers:
 * Overview, Partners, Leads and Partner approvals — and, unlike a partner
 * manager, sees EVERY partner and lead, and approves like an admin (bank
 * details included, the owner's choice on 6 Oct). The rest of the sales team
 * stays out.
 */
const TAG = `sm-partners-${Date.now()}`
const app = createApp()
const tokenFor = (id, role) =>
  jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

let pmA, pmB, pA, pB, pPending, pPending2, lA, lB
let tokSM, tokPM, tokTL, tokSE

beforeAll(async () => {
  const mkUser = (name, role) =>
    prisma.user.create({
      data: { name, email: `${name}-${TAG}@t.local`, passwordHash: 'x', role, isActive: true },
    })
  pmA = await mkUser('pm-a', 'PARTNER_MANAGER')
  pmB = await mkUser('pm-b', 'PARTNER_MANAGER')
  const sm = await mkUser('sm', 'SALES_MANAGER')
  const tl = await mkUser('tl', 'TEAM_LEADER')
  const se = await mkUser('se', 'SALES_EXECUTIVE')

  const stamp = String(Date.now()).slice(-8)
  const mkPartner = (name, mobile, emp, status) =>
    prisma.partner.create({
      data: { name, type: 'DSA', mobile, email: `${name}-${TAG}@t.local`, status, onboardedById: emp.id },
    })
  pA = await mkPartner('partner-a', `91${stamp}`, pmA, 'APPROVED')
  pB = await mkPartner('partner-b', `81${stamp}`, pmB, 'APPROVED')
  pPending = await mkPartner('partner-pending', `71${stamp}`, pmB, 'PENDING_APPROVAL')
  pPending2 = await mkPartner('partner-pending2', `61${stamp}`, pmA, 'PENDING_APPROVAL')

  const mkLead = (p, emp, name) =>
    prisma.lead.create({
      data: { partnerId: p.id, employeeId: emp.id, customerName: name, customerMobile: '9800000000' },
    })
  lA = await mkLead(pA, pmA, `cust-a-${TAG}`)
  lB = await mkLead(pB, pmB, `cust-b-${TAG}`)

  tokSM = tokenFor(sm.id, 'SALES_MANAGER')
  tokPM = tokenFor(pmA.id, 'PARTNER_MANAGER')
  tokTL = tokenFor(tl.id, 'TEAM_LEADER')
  tokSE = tokenFor(se.id, 'SALES_EXECUTIVE')
})

afterAll(async () => {
  const ps = [pA?.id, pB?.id, pPending?.id, pPending2?.id].filter(Boolean)
  await prisma.leadStatusEvent.deleteMany({ where: { lead: { partnerId: { in: ps } } } })
  await prisma.lead.deleteMany({ where: { partnerId: { in: ps } } })
  await prisma.partner.deleteMany({ where: { id: { in: ps } } })
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } })
})

const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const ids = (res) => res.body.data.map((x) => x.id)

describe('a sales manager works the whole partner network', () => {
  it('sees every partner, whoever onboarded them', async () => {
    const res = await request(app).get('/api/v1/partners').set(as(tokSM))
    expect(res.status).toBe(200)
    expect(ids(res)).toEqual(expect.arrayContaining([pA.id, pB.id, pPending.id]))
  })

  it('sees every partner lead and can update one', async () => {
    const list = await request(app).get('/api/v1/leads').set(as(tokSM))
    expect(list.status).toBe(200)
    const leadIds = (list.body.data.items ?? list.body.data).map((l) => l.id)
    expect(leadIds).toEqual(expect.arrayContaining([lA.id, lB.id]))

    const upd = await request(app)
      .patch(`/api/v1/leads/${lB.id}/status`)
      .set(as(tokSM))
      .send({ status: 'CONTACTED' })
    expect(upd.status).toBe(200)
    expect(upd.body.data.status).toBe('CONTACTED')
  })

  it('opens the network overview, the invites list and the rate card', async () => {
    expect((await request(app).get('/api/v1/partner-dashboard').set(as(tokSM))).status).toBe(200)
    expect((await request(app).get('/api/v1/partner-invites').set(as(tokSM))).status).toBe(200)
    expect((await request(app).get('/api/v1/rate-card').set(as(tokSM))).status).toBe(200)
  })

  it('approves and rejects like an admin, and reads documents and bank details', async () => {
    expect((await request(app).get(`/api/v1/partners/${pPending.id}/documents`).set(as(tokSM))).status).toBe(200)
    const bank = await request(app).get(`/api/v1/partners/${pPending.id}/bank-account`).set(as(tokSM))
    expect(bank.status).not.toBe(403)

    const ok = await request(app).post(`/api/v1/partners/${pPending.id}/approve`).set(as(tokSM)).send({})
    expect(ok.status).toBe(200)
    const no = await request(app)
      .post(`/api/v1/partners/${pPending2.id}/reject`)
      .set(as(tokSM))
      .send({ reason: 'Blurred PAN photo' })
    expect(no.status).toBe(200)

    const after = await prisma.partner.findMany({ where: { id: { in: [pPending.id, pPending2.id] } } })
    expect(Object.fromEntries(after.map((p) => [p.id, p.status]))).toEqual({
      [pPending.id]: 'APPROVED',
      [pPending2.id]: 'REJECTED',
    })
  })
})

describe('everyone else stays where they were', () => {
  it('a partner manager still sees only their own partners and leads', async () => {
    const partners = await request(app).get('/api/v1/partners').set(as(tokPM))
    expect(ids(partners)).toContain(pA.id)
    expect(ids(partners)).not.toContain(pB.id)
    const leads = await request(app).get('/api/v1/leads').set(as(tokPM))
    const leadIds = (leads.body.data.items ?? leads.body.data).map((l) => l.id)
    expect(leadIds).toContain(lA.id)
    expect(leadIds).not.toContain(lB.id)
  })

  it('a partner manager still cannot approve, or read bank details', async () => {
    expect((await request(app).post(`/api/v1/partners/${pA.id}/approve`).set(as(tokPM)).send({})).status).toBe(403)
    expect((await request(app).get(`/api/v1/partners/${pA.id}/bank-account`).set(as(tokPM))).status).toBe(403)
  })

  it('team leaders and sales executives are refused', async () => {
    for (const tok of [tokTL, tokSE]) {
      expect((await request(app).get('/api/v1/partners').set(as(tok))).status).toBe(403)
      expect((await request(app).get('/api/v1/leads').set(as(tok))).status).toBe(403)
      expect((await request(app).get('/api/v1/partner-dashboard').set(as(tok))).status).toBe(403)
      expect((await request(app).post(`/api/v1/partners/${pA.id}/approve`).set(as(tok)).send({})).status).toBe(403)
    }
  })
})
