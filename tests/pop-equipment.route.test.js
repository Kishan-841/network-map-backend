import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const STAMP = Date.now()
const ADMIN = `pe-admin-${STAMP}`
const app = createApp()
const auth = [
  'Authorization',
  `Bearer ${jwt.sign({ sub: ADMIN, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]
let zoneId = null
let popId = null

beforeAll(async () => {
  zoneId = (await prisma.zone.findFirst()).id
  await prisma.user.create({
    data: { id: ADMIN, name: 'PE Admin', email: `${ADMIN}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
  })
})

afterAll(async () => {
  await prisma.pop.deleteMany({ where: { name: { startsWith: 'PE POP ' } } })
  await prisma.systemLog.deleteMany({ where: { userId: ADMIN } })
  await prisma.user.deleteMany({ where: { id: ADMIN } })
})

describe('the survey sheet a POP carries', () => {
  it('saves the rack, its condition, the UPS batteries and where the rack stands', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth)
      .send({
        name: `PE POP ${STAMP}`,
        zoneId,
        latitude: 18.52,
        longitude: 73.85,
        serverLocation: '2nd floor, back room',
        rackSize: '22U',
        rackCondition: 'OK',
        upsBatteryCount: 2,
      })
    expect(res.status).toBe(201)
    popId = res.body.data.id
    expect(res.body.data).toMatchObject({
      serverLocation: '2nd floor, back room',
      rackSize: '22U',
      rackCondition: 'OK',
      upsBatteryCount: 2,
    })
  })

  it('refuses a rack size that is not one we stock', async () => {
    const res = await request(app)
      .patch(`/api/v1/pops/${popId}`)
      .set(...auth)
      .send({ rackSize: '19U' })
    expect(res.status).toBe(400)
  })

  it('refuses a rack condition outside OK / DAMAGED', async () => {
    const res = await request(app).patch(`/api/v1/pops/${popId}`).set(...auth).send({ rackCondition: 'fine' })
    expect(res.status).toBe(400)
  })

  it('refuses a battery count that is not 1, 2 or 4', async () => {
    const res = await request(app).patch(`/api/v1/pops/${popId}`).set(...auth).send({ upsBatteryCount: 3 })
    expect(res.status).toBe(400)
  })

  it('lets the whole sheet be left blank — old POPs stay exactly as they were', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth)
      .send({ name: `PE POP bare ${STAMP}`, zoneId, latitude: 18.5, longitude: 73.8 })
    expect(res.status).toBe(201)
    expect(res.body.data.rackSize).toBeNull()
    expect(res.body.data.devices).toEqual([])
  })
})

describe('the boxes in the rack', () => {
  it('adds a switch and a mikrotik, each with its address', async () => {
    for (const kind of ['SWITCH', 'MIKROTIK']) {
      const res = await request(app)
        .post(`/api/v1/pops/${popId}/devices`)
        .set(...auth)
        .send({ kind, label: `${kind} 1`, ipAddress: '10.0.0.1' })
      expect(res.status, kind).toBe(201)
    }
    const pop = await request(app).get(`/api/v1/pops`).set(...auth)
    const mine = pop.body.data.find((p) => p.id === popId)
    expect(mine.devices.map((d) => d.kind).sort()).toEqual(['MIKROTIK', 'SWITCH'])
  })

  it('takes as many switches as the rack holds', async () => {
    const second = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'SWITCH', label: 'Switch 2', ipAddress: '10.0.0.2' })
    expect(second.status).toBe(201)
    const pop = await request(app).get('/api/v1/pops').set(...auth)
    const switches = pop.body.data.find((p) => p.id === popId).devices.filter((d) => d.kind === 'SWITCH')
    expect(switches).toHaveLength(2)
  })

  it('keeps a switch known only by its model — no IP is not a reason to drop it', async () => {
    const res = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'SWITCH', label: 'model only', model: 'CRS326', speed: '10G' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ model: 'CRS326', speed: '10G', ipAddress: null })
  })

  it('keeps a Mikrotik with just a name', async () => {
    const res = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'MIKROTIK', label: 'RB by the door' })
    expect(res.status).toBe(201)
  })

  it('refuses a device with nothing filled in at all', async () => {
    const res = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'SWITCH' })
    expect(res.status).toBe(400)
  })

  it('refuses an address that is not an address', async () => {
    const res = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'SWITCH', ipAddress: 'somewhere' })
    expect(res.status).toBe(400)
  })

  it('takes an FMS by its port count, keeps one known only by name, and refuses a count we do not stock', async () => {
    const ok = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'FMS', label: 'FMS 1', portCount: 48 })
    expect(ok.status).toBe(201)
    const bad = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'FMS', portCount: 36 })
    expect(bad.status).toBe(400)
    // A port count we do not know yet is not a reason to lose the FMS.
    const portless = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'FMS', label: 'portless' })
    expect(portless.status).toBe(201)
  })

  it('edits and removes one', async () => {
    const made = await request(app)
      .post(`/api/v1/pops/${popId}/devices`)
      .set(...auth)
      .send({ kind: 'MIKROTIK', label: 'temp', ipAddress: '10.0.0.9' })
    const deviceId = made.body.data.id
    const edited = await request(app)
      .patch(`/api/v1/pops/${popId}/devices/${deviceId}`)
      .set(...auth)
      .send({ ipAddress: '10.0.0.10' })
    expect(edited.status).toBe(200)
    expect(edited.body.data.ipAddress).toBe('10.0.0.10')
    const gone = await request(app).delete(`/api/v1/pops/${popId}/devices/${deviceId}`).set(...auth)
    expect(gone.status).toBe(200)
  })

  it('will not touch a device that belongs to another POP', async () => {
    const other = await request(app)
      .post('/api/v1/pops')
      .set(...auth)
      .send({ name: `PE POP other ${STAMP}`, zoneId, latitude: 18.51, longitude: 73.84 })
    const res = await request(app)
      .delete(`/api/v1/pops/${other.body.data.id}/devices/no-such-device`)
      .set(...auth)
    expect(res.status).toBe(404)
  })
})

describe('an OLT carries its address too', () => {
  it('saves and returns it', async () => {
    const res = await request(app)
      .post(`/api/v1/pops/${popId}/olts`)
      .set(...auth)
      .send({ name: 'OLT-1', ponPortCount: 8, ipAddress: '10.0.1.1' })
    expect(res.status).toBe(201)
    expect(res.body.data.ipAddress).toBe('10.0.1.1')
  })
})

describe('the whole rack saves with the POP, in one go', () => {
  let nestedId = null

  it('creates a POP with its OLTs, switches and FMS in one request', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth)
      .send({
        name: `PE POP nested ${STAMP}`,
        zoneId,
        latitude: 18.53,
        longitude: 73.86,
        rackSize: '27U',
        olts: [{ name: 'OLT-A', ponPortCount: 8, ipAddress: '10.1.0.1' }],
        devices: [
          { kind: 'SWITCH', label: 'SW 1', ipAddress: '10.1.0.2' },
          { kind: 'SWITCH', label: 'SW 2', ipAddress: '10.1.0.3' },
          { kind: 'FMS', label: 'FMS 1', portCount: 24 },
        ],
      })
    expect(res.status).toBe(201)
    nestedId = res.body.data.id
    expect(res.body.data.olts).toHaveLength(1)
    expect(res.body.data.devices).toHaveLength(3)
    expect(res.body.data.olts[0].ipAddress).toBe('10.1.0.1')
  })

  it('keeps a row it is given back, edits it, and drops the one it is not', async () => {
    const before = (await request(app).get('/api/v1/pops').set(...auth)).body.data.find(
      (p) => p.id === nestedId,
    )
    const keep = before.devices.find((d) => d.label === 'SW 1')
    const res = await request(app)
      .patch(`/api/v1/pops/${nestedId}`)
      .set(...auth)
      .send({
        devices: [
          { id: keep.id, kind: 'SWITCH', label: 'SW 1 renamed', ipAddress: '10.1.0.9' },
          { kind: 'MIKROTIK', label: 'MT 1', ipAddress: '10.1.0.4' },
        ],
      })
    expect(res.status).toBe(200)
    const kinds = res.body.data.devices.map((d) => `${d.kind}:${d.label}`).sort()
    expect(kinds).toEqual(['MIKROTIK:MT 1', 'SWITCH:SW 1 renamed'])
    expect(res.body.data.devices.find((d) => d.id === keep.id).ipAddress).toBe('10.1.0.9')
  })

  it('leaves the lists alone when the patch does not mention them', async () => {
    const res = await request(app)
      .patch(`/api/v1/pops/${nestedId}`)
      .set(...auth)
      .send({ rackCondition: 'DAMAGED' })
    expect(res.status).toBe(200)
    expect(res.body.data.devices).toHaveLength(2)
    expect(res.body.data.olts).toHaveLength(1)
  })

  it('clears a list when it is given an empty one', async () => {
    const res = await request(app)
      .patch(`/api/v1/pops/${nestedId}`)
      .set(...auth)
      .send({ devices: [] })
    expect(res.status).toBe(200)
    expect(res.body.data.devices).toEqual([])
  })

  it('refuses two OLTs with the same name rather than failing halfway', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth)
      .send({
        name: `PE POP clash ${STAMP}`,
        zoneId,
        latitude: 18.54,
        longitude: 73.87,
        olts: [
          { name: 'same', ponPortCount: 8 },
          { name: 'same', ponPortCount: 16 },
        ],
      })
    expect(res.status).toBe(409)
    const pops = await request(app).get('/api/v1/pops').set(...auth)
    expect(pops.body.data.some((p) => p.name === `PE POP clash ${STAMP}`)).toBe(false)
  })

  it('will not drop an OLT that still feeds a fiber', async () => {
    const pop = await request(app)
      .post('/api/v1/pops')
      .set(...auth)
      .send({
        name: `PE POP fed ${STAMP}`,
        zoneId,
        latitude: 18.55,
        longitude: 73.88,
        olts: [{ name: 'OLT-fed', ponPortCount: 8 }],
      })
    const oltId = pop.body.data.olts[0].id
    const fiber = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({
        name: `PE FIB ${STAMP}`,
        coreCount: 2,
        zoneId,
        oltId,
        ponPort: 1,
        points: [
          { latitude: 18.55, longitude: 73.88 },
          { latitude: 18.551, longitude: 73.881 },
        ],
      })
    expect(fiber.status).toBe(201)

    const res = await request(app)
      .patch(`/api/v1/pops/${pop.body.data.id}`)
      .set(...auth)
      .send({ olts: [] })
    expect(res.status).toBe(409)

    await request(app).delete(`/api/v1/fibers/${fiber.body.data.id}`).set(...auth)
  })
})

describe('the make and model of what is in the rack', () => {
  let id = null

  it('saves a switch by speed, model and address', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth)
      .send({
        name: `PE POP models ${STAMP}`,
        zoneId,
        latitude: 18.56,
        longitude: 73.89,
        upsBatteryCount: 0,
        olts: [{ name: 'OLT-G', ponPortCount: 16, ipAddress: '10.3.0.1', type: 'GPON', model: 'C320' }],
        devices: [
          { kind: 'SWITCH', label: 'SW', ipAddress: '10.3.0.2', speed: '10G', model: 'CRS326' },
          { kind: 'MIKROTIK', ipAddress: '10.3.0.3', model: 'RB4011' },
        ],
      })
    expect(res.status).toBe(201)
    id = res.body.data.id
    const sw = res.body.data.devices.find((d) => d.kind === 'SWITCH')
    expect(sw).toMatchObject({ speed: '10G', model: 'CRS326' })
    expect(res.body.data.devices.find((d) => d.kind === 'MIKROTIK').model).toBe('RB4011')
    expect(res.body.data.olts[0]).toMatchObject({ type: 'GPON', model: 'C320' })
  })

  it('takes a UPS with no batteries at all', async () => {
    const pop = await request(app).get('/api/v1/pops').set(...auth)
    expect(pop.body.data.find((p) => p.id === id).upsBatteryCount).toBe(0)
  })

  it('refuses a switch speed we do not sell', async () => {
    const res = await request(app)
      .patch(`/api/v1/pops/${id}`)
      .set(...auth)
      .send({ devices: [{ kind: 'SWITCH', ipAddress: '10.3.0.9', speed: '40G' }] })
    expect(res.status).toBe(400)
  })

  it('refuses an OLT that is neither GPON nor EPON', async () => {
    const res = await request(app)
      .patch(`/api/v1/pops/${id}`)
      .set(...auth)
      .send({ olts: [{ name: 'OLT-X', ponPortCount: 8, type: 'XPON' }] })
    expect(res.status).toBe(400)
  })

  it('leaves the make and model optional — the sheet is often filled in later', async () => {
    const res = await request(app)
      .patch(`/api/v1/pops/${id}`)
      .set(...auth)
      .send({ devices: [{ kind: 'SWITCH', ipAddress: '10.3.0.4' }] })
    expect(res.status).toBe(200)
    expect(res.body.data.devices[0].speed).toBeNull()
    expect(res.body.data.devices[0].model).toBeNull()
  })
})
