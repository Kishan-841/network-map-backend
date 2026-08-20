import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { getStorageProvider } from '../src/lib/storage/index.js'

// Photo URLs must come from OUR storage (the service enforces it), so build
// them from the active provider rather than hard-coding a path.
const storage = getStorageProvider()
const ownedUrl = (name) => {
  const probe = storage.keyFromUrl(`/uploads/${name}`)
  return probe ? `/uploads/${name}` : `${process.env.R2_PUBLIC_URL}/${name}`
}

const token = (user) => jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: '1h' })
const auth = (user) => ['Authorization', `Bearer ${token(user)}`]

describe('acquisition team end-to-end', () => {
  const stamp = Date.now()
  const app = createApp()
  let admin, lead, agent, otherAgent, city, coverageBuilding

  beforeAll(async () => {
    admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    city = await prisma.city.create({ data: { name: `AcqCity-${stamp}` } })
    lead = await prisma.user.create({
      data: { name: 'Lead', email: `lead-${stamp}@t.local`, passwordHash: 'x', role: 'ACQUISITION_LEAD' },
    })
    otherAgent = await prisma.user.create({
      data: {
        name: 'Other agent',
        email: `other-${stamp}@t.local`,
        passwordHash: 'x',
        role: 'ACQUISITION_AGENT',
        pincodes: { create: [{ pincode: '411057', cityId: city.id }] },
      },
    })
    const zone = await prisma.zone.findFirst()
    coverageBuilding = await prisma.building.create({
      data: {
        buildingName: `CoverageOnly-${stamp}`,
        formattedAddress: 'x',
        latitude: 18.9,
        longitude: 73.9,
        zoneId: zone.id,
        createdById: admin.id,
      },
    })
  })

  afterAll(async () => {
    await prisma.building.deleteMany({
      where: { OR: [{ pincode: '411014' }, { id: coverageBuilding.id }, { pincode: '411057' }] },
    })
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@t.local` } } })
    await prisma.city.deleteMany({ where: { id: city.id } })
  })

  it('a lead can create an agent with a city + pincodes, but not other roles', async () => {
    const created = await request(app)
      .post('/api/v1/users')
      .set(...auth(lead))
      .send({
        name: 'Field Agent',
        email: `agent-${stamp}@t.local`,
        password: 'agent1234',
        role: 'ACQUISITION_AGENT',
        cityId: city.id,
        pincodes: ['411014'],
      })
    expect(created.status).toBe(201)
    expect(created.body.data.pincodes.map((p) => p.pincode)).toEqual(['411014'])
    agent = await prisma.user.findUnique({ where: { email: `agent-${stamp}@t.local` } })

    const forbidden = await request(app)
      .post('/api/v1/users')
      .set(...auth(lead))
      .send({ name: 'X', email: `nope-${stamp}@t.local`, password: 'agent1234', role: 'SURVEYOR' })
    expect(forbidden.status).toBe(403)
  })

  it('agent logs a building with contact + selfies; wrong pincode is refused', async () => {
    const payload = {
      buildingName: `AcqBldg-${stamp}`,
      formattedAddress: '1 Test Road',
      latitude: 18.52,
      longitude: 73.85,
      pincode: '411014',
      contact: { contactName: 'R. Sharma', contactPhone: '9876543210', designation: 'SECRETARY' },
      photos: [
        { type: 'SELFIE', url: ownedUrl('selfie.jpg') },
        { type: 'CONTACT_PERSON', url: ownedUrl('contact.jpg') },
      ],
    }
    const ok = await request(app).post('/api/v1/buildings').set(...auth(agent)).send(payload)
    expect(ok.status).toBe(201)
    expect(ok.body.data.source).toBe('ACQUISITION')
    expect(ok.body.data.zoneId).toBeNull()
    expect(ok.body.data.contact.contactName).toBe('R. Sharma')

    const wrongPin = await request(app)
      .post('/api/v1/buildings')
      .set(...auth(agent))
      .send({ ...payload, buildingName: 'Nope', pincode: '400001' })
    expect(wrongPin.status).toBe(403)

    const noContact = await request(app)
      .post('/api/v1/buildings')
      .set(...auth(agent))
      .send({ ...payload, buildingName: 'Nope2', contact: undefined })
    expect(noContact.status).toBe(400)
  })

  it('agent sees ONLY their own rows — never the coverage registry', async () => {
    const res = await request(app).get('/api/v1/buildings?pageSize=500').set(...auth(agent))
    expect(res.status).toBe(200)
    const names = res.body.data.items.map((b) => b.buildingName)
    expect(names).toContain(`AcqBldg-${stamp}`)
    expect(names).not.toContain(`CoverageOnly-${stamp}`)
    expect(res.body.data.items.every((b) => b.createdById === agent.id)).toBe(true)

    const foreign = await request(app)
      .get(`/api/v1/buildings/${coverageBuilding.id}`)
      .set(...auth(agent))
    expect(foreign.status).toBe(404)
  })

  it('lead sees every acquisition row but no coverage row', async () => {
    const res = await request(app).get('/api/v1/buildings?pageSize=500').set(...auth(lead))
    const names = res.body.data.items.map((b) => b.buildingName)
    expect(names).toContain(`AcqBldg-${stamp}`)
    expect(names).not.toContain(`CoverageOnly-${stamp}`)
    const blocked = await request(app)
      .get(`/api/v1/buildings/${coverageBuilding.id}`)
      .set(...auth(lead))
    expect(blocked.status).toBe(404)
  })

  it('admins and surveyors do not see acquisition rows in the coverage registry', async () => {
    const res = await request(app).get('/api/v1/buildings?pageSize=500').set(...auth(admin))
    const names = res.body.data.items.map((b) => b.buildingName)
    expect(names).toContain(`CoverageOnly-${stamp}`)
    expect(names).not.toContain(`AcqBldg-${stamp}`)
  })

  it('nearby masks other people\'s buildings for an agent', async () => {
    const res = await request(app)
      .get('/api/v1/buildings/nearby?latitude=18.9&longitude=73.9&radius=500')
      .set(...auth(agent))
    expect(res.status).toBe(200)
    const hit = res.body.data.find((b) => b.id === coverageBuilding.id)
    if (hit) {
      expect(hit.masked).toBe(true)
      expect(hit.buildingName).toBeNull()
      expect(hit.formattedAddress ?? null).toBeNull()
      expect(typeof hit.distanceMeters).toBe('number')
    }
  })

  it('lead dashboard reports per-agent counts; agents cannot read it', async () => {
    const res = await request(app).get('/api/v1/stats/acquisition').set(...auth(lead))
    expect(res.status).toBe(200)
    const row = res.body.data.agents.find((a) => a.id === agent.id)
    expect(row.buildings).toBeGreaterThanOrEqual(1)
    expect(row.pincodes).toEqual(['411014'])
    expect(res.body.data.contactsCaptured).toBeGreaterThanOrEqual(1)

    const denied = await request(app).get('/api/v1/stats/acquisition').set(...auth(agent))
    expect(denied.status).toBe(403)
  })
})
