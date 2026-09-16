import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: '1h' })

// Exactly what the map is promised — no more (photos/contacts/permission would
// ride along on every one of ~1200 rows) and no less (the selected-building
// card reads floors/homePass/wings and the zone name straight off these).
const MARKER_KEYS = [
  'id',
  'buildingName',
  'formattedAddress',
  'latitude',
  'longitude',
  'isLive',
  'feasibleStatus',
  'source',
  'createdById',
  'createdAt',
  'zone',
  'cityId',
  'pincode',
  'details',
  'city',
  'contact',
]

// The reported bug: /map drew 500 pins out of 1155 buildings, because it read
// the paginated list endpoint. The markers feed has no page to fall off.
describe('GET /buildings/markers', () => {
  const stamp = Date.now()
  let zone
  let admin
  let surveyor
  const buildingIds = []
  let ownBuilding
  let otherBuilding
  let acquisitionBuilding

  beforeAll(async () => {
    zone = await prisma.zone.findFirst()
    admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    surveyor = await prisma.user.create({
      data: {
        name: 'Markers Test Surveyor',
        email: `markers-test-${stamp}@test.local`,
        passwordHash: 'not-a-real-hash',
        role: 'SURVEYOR',
      },
    })
    // Created BY the zoneless surveyor — the only coverage row they may see.
    ownBuilding = await prisma.building.create({
      data: {
        buildingName: `MarkersOwn-${stamp}`,
        formattedAddress: '1 Markers St',
        latitude: 18.52,
        longitude: 73.82,
        zoneId: zone.id,
        createdById: surveyor.id,
        details: { create: { homePass: 42, floors: 7, wings: 2 } },
      },
    })
    otherBuilding = await prisma.building.create({
      data: {
        buildingName: `MarkersOther-${stamp}`,
        formattedAddress: '2 Markers St',
        latitude: 18.53,
        longitude: 73.83,
        zoneId: zone.id,
        createdById: admin.id,
      },
    })
    acquisitionBuilding = await prisma.building.create({
      data: {
        buildingName: `MarkersAcq-${stamp}`,
        formattedAddress: '3 Markers St',
        latitude: 18.54,
        longitude: 73.84,
        source: 'ACQUISITION',
        pincode: '411045',
        createdById: admin.id,
      },
    })
    buildingIds.push(ownBuilding.id, otherBuilding.id, acquisitionBuilding.id)
  })

  afterAll(async () => {
    try {
      await prisma.buildingDetails.deleteMany({ where: { buildingId: { in: buildingIds } } })
      await prisma.building.deleteMany({ where: { id: { in: buildingIds } } })
    } finally {
      await prisma.user.deleteMany({ where: { id: surveyor.id } })
    }
  })

  it('hands an admin every coverage building, not a page of them', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings/markers')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const ids = res.body.data.map((b) => b.id)
    expect(ids).toContain(ownBuilding.id)
    expect(ids).toContain(otherBuilding.id)

    // The count the map draws must equal the count the list reports.
    const total = await prisma.building.count({ where: { source: 'COVERAGE' } })
    expect(res.body.data).toHaveLength(total)
    expect(total).toBeGreaterThan(0)
  })

  it('carries exactly the marker fields', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings/markers')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
    const marker = res.body.data.find((b) => b.id === ownBuilding.id)
    expect(Object.keys(marker).sort()).toEqual([...MARKER_KEYS].sort())
    expect(marker.zone).toEqual({ id: zone.id, name: zone.name, operatorId: zone.operatorId })
    expect(marker.details).toEqual({ homePass: 42, floors: 7, wings: 2 })
  })

  it('shows a zoneless surveyor only their own buildings', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings/markers')
      .set('Authorization', `Bearer ${tokenFor(surveyor)}`)
    expect(res.status).toBe(200)
    const ids = res.body.data.map((b) => b.id)
    expect(ids).toContain(ownBuilding.id)
    expect(ids).not.toContain(otherBuilding.id)
    expect(res.body.data.every((b) => b.createdById === surveyor.id)).toBe(true)
  })

  it('narrows to the acquisition registry with ?source=ACQUISITION', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings/markers?source=ACQUISITION')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
    expect(res.status).toBe(200)
    const ids = res.body.data.map((b) => b.id)
    expect(ids).toContain(acquisitionBuilding.id)
    expect(ids).not.toContain(ownBuilding.id)
    expect(res.body.data.every((b) => b.source === 'ACQUISITION')).toBe(true)
  })

  it('accepts and ignores page/pageSize — the map has no pages', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings/markers?page=1&pageSize=1')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(1)
  })

  it('rejects an unauthenticated request', async () => {
    const res = await request(createApp()).get('/api/v1/buildings/markers')
    expect(res.status).toBe(401)
  })
})
