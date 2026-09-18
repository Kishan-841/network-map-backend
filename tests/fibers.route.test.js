import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, {
    audience: 'staff',
    expiresIn: '1h',
  })

// A fiber records the zone it runs in, so these fixtures pick any real one.
const anyZoneId = async () => (await prisma.zone.findFirst()).id

// Fiber writes need the per-user tick, not just a role — see seed-test-users.
const fiberManagerToken = jwt.sign({ sub: 'test-fiber-manager', role: 'MANAGER' }, env.jwtSecret, {
  audience: 'staff',
  expiresIn: '1h',
})

describe('fibers API', () => {
  it('places a splitter on the line: S-code, 1:6 ratio, then retype the point and delete it', async () => {
    const app = createApp()
    const manager = ['Authorization', `Bearer ${fiberManagerToken}`]
    let fiberId = null
    let splitterId = null
    let popId = null

    try {
      const pop = await request(app)
        .post('/api/v1/pops')
        .set(...manager)
        .send({ name: `POP-SPL-${Date.now()}`, latitude: 18.6, longitude: 73.9 })
      expect(pop.status).toBe(201)
      popId = pop.body.data.id

      const created = await request(app)
        .post('/api/v1/fibers')
        .set(...manager)
        .send({
          zoneId: await anyZoneId(),
          coreCount: 4,
          points: [
            { type: 'POP', popId, latitude: 18.6, longitude: 73.9 },
            { type: 'SPLITTER', newSplitter: { ratio: 'R1_6', fiberType: 'SUB', location: 'S2' }, latitude: 18.601, longitude: 73.901 },
            { type: 'WAYPOINT', latitude: 18.602, longitude: 73.902 },
            { type: 'CLOSURE', newClosure: { kind: 'Compass' }, latitude: 18.603, longitude: 73.903 },
          ],
        })
      expect(created.status).toBe(201)
      const fiber = created.body.data
      fiberId = fiber.id
      splitterId = fiber.points[1].splitterId

      expect(fiber.points[1].type).toBe('SPLITTER')
      expect(fiber.points[1].label).toMatch(/^S\d+$/)
      expect(fiber.points[1].splitter).toBe('1:6')
      expect(fiber.points[1].splitterFiberType).toBe('SUB')
      expect(fiber.points[1].splitterLocation).toBe('S2')
      expect(fiber.totals.splitterCount).toBe(1)
      // POP → SPLITTER → CLOSURE: the splitter bounds segments like a closure.
      expect(fiber.segments).toHaveLength(2)
      // The line that carries it is the line that feeds it.
      expect(fiber.splitters.map((s) => s.id)).toContain(splitterId)
      expect(fiber.splitters[0].outputs).toHaveLength(6)

      // A point still holding the splitter blocks the delete (FK is RESTRICT).
      const tooSoon = await request(app)
        .delete(`/api/v1/splitters/${splitterId}`)
        .set(...manager)
      expect(tooSoon.status).toBe(409)

      // Retyping the point back to a plain bend releases it.
      const retyped = await request(app)
        .patch(`/api/v1/fibers/${fiberId}`)
        .set(...manager)
        .send({
          points: [
            { type: 'POP', popId, latitude: 18.6, longitude: 73.9 },
            { type: 'WAYPOINT', latitude: 18.601, longitude: 73.901 },
            { type: 'WAYPOINT', latitude: 18.602, longitude: 73.902 },
            { type: 'CLOSURE', closureId: fiber.points[3].closureId, latitude: 18.603, longitude: 73.903 },
          ],
        })
      expect(retyped.status).toBe(200)
      expect(retyped.body.data.totals.splitterCount).toBe(0)

      const gone = await request(app)
        .delete(`/api/v1/splitters/${splitterId}`)
        .set(...manager)
      expect(gone.status).toBe(200)
      splitterId = null

      // Deleting the fiber takes its remaining line splitters with it.
      const second = await request(app)
        .patch(`/api/v1/fibers/${fiberId}`)
        .set(...manager)
        .send({
          points: [
            { type: 'POP', popId, latitude: 18.6, longitude: 73.9 },
            { type: 'SPLITTER', newSplitter: { ratio: 'R1_2' }, latitude: 18.604, longitude: 73.904 },
          ],
        })
      expect(second.status).toBe(200)
      const secondId = second.body.data.points[1].splitterId
      expect(second.body.data.points[1].label).toMatch(/^S\d+$/)

      const closureId = fiber.points[3].closureId
      expect((await request(app).delete(`/api/v1/fibers/${fiberId}`).set(...manager)).status).toBe(200)
      fiberId = null
      expect(await prisma.splitter.findUnique({ where: { id: secondId } })).toBeNull()
      // The closure the line passed through is untouched.
      expect(await prisma.closure.findUnique({ where: { id: closureId } })).not.toBeNull()
      await prisma.closure.delete({ where: { id: closureId } }).catch(() => {})
    } finally {
      if (fiberId) await request(app).delete(`/api/v1/fibers/${fiberId}`).set(...manager)
      if (splitterId) await request(app).delete(`/api/v1/splitters/${splitterId}`).set(...manager)
      if (popId) await request(app).delete(`/api/v1/pops/${popId}`).set(...manager)
    }
  })

  it('runs the acceptance flow: create → splitter feed → cut → restore → delete', async () => {
    const app = createApp()
    const stamp = Date.now()
    const manager = ['Authorization', `Bearer ${fiberManagerToken}`]

    let popId = null
    let oltId = null
    let buildingAId = null
    let buildingBId = null
    let closureId = null
    let splitterId = null
    let fiberId1 = null
    let fiberId2 = null

    try {
      // Unauthenticated read is rejected.
      expect((await request(app).get('/api/v1/fibers')).status).toBe(401)

      // SURVEYOR can read, cannot write.
      const surveyor = ['Authorization', `Bearer ${tokenFor('SURVEYOR')}`]
      expect((await request(app).get('/api/v1/fibers').set(...surveyor)).status).toBe(200)
      expect((await request(app).post('/api/v1/fibers').set(...surveyor).send({})).status).toBe(403)

      const pop = await request(app)
        .post('/api/v1/pops')
        .set(...manager)
        .send({ name: `POP-FIB-${stamp}`, latitude: 18.5, longitude: 73.8 })
      expect(pop.status).toBe(201)
      popId = pop.body.data.id

      const olt = await request(app)
        .post(`/api/v1/pops/${popId}/olts`)
        .set(...manager)
        .send({ name: `OLT-FIB-${stamp}`, ponPortCount: 16 })
      expect(olt.status).toBe(201)
      oltId = olt.body.data.id

      const buildingA = await prisma.building.create({
        data: {
          buildingName: `Fiber-Bldg-A-${stamp}`,
          formattedAddress: '1 Fiber St',
          latitude: 18.51,
          longitude: 73.81,
          createdById: 'test-admin',
        },
      })
      buildingAId = buildingA.id

      const buildingB = await prisma.building.create({
        data: {
          buildingName: `Fiber-Bldg-B-${stamp}`,
          formattedAddress: '2 Fiber St',
          latitude: 18.52,
          longitude: 73.82,
          createdById: 'test-admin',
        },
      })
      buildingBId = buildingB.id

      // First fiber: POP → WAYPOINT → BUILDING(A) → new CLOSURE (its last point,
      // so the closure can later auto-claim this fiber as a splitter's input).
      const created = await request(app)
        .post('/api/v1/fibers')
        .set(...manager)
        .send({
          zoneId: await anyZoneId(),
          coreCount: 6,
          oltId,
          ponPort: 3,
          points: [
            { type: 'POP', popId, latitude: 18.5, longitude: 73.8 },
            { type: 'WAYPOINT', latitude: 18.505, longitude: 73.805 },
            { type: 'BUILDING', buildingId: buildingAId, latitude: 18.51, longitude: 73.81 },
            { type: 'CLOSURE', newClosure: { kind: 'pole' }, latitude: 18.515, longitude: 73.815 },
          ],
        })
      expect(created.status).toBe(201)
      const fiber1 = created.body.data
      // Capture every id the `finally` block needs to clean up before any
      // assertion below can throw — an assertion failure here must not leak
      // the fiber or the closure the transaction above already persisted.
      fiberId1 = fiber1.id
      closureId = fiber1.points?.[3]?.closureId ?? null
      expect(fiber1.points[3].label).toMatch(/^JC-\d{4}$/)
      expect(fiber1.segments).toHaveLength(2)
      expect(fiber1.totals.closureCount).toBe(1)

      const seg0 = fiber1.segments[0].id
      const seg1 = fiber1.segments[1].id

      const laid = await request(app)
        .patch(`/api/v1/fibers/${fiberId1}/segments/${seg0}`)
        .set(...manager)
        .send({ fiberLaidMeters: 420 })
      expect(laid.status).toBe(200)
      expect(laid.body.data.totals.fiberLaidMeters).toBe(420)

      const splitter = await request(app)
        .post(`/api/v1/closures/${closureId}/splitters`)
        .set(...manager)
        .send({ ratio: 'R1_2' })
      expect(splitter.status).toBe(201)
      splitterId = splitter.body.data?.id ?? null
      expect(splitter.body.data.inputFiberId).toBe(fiberId1)

      // Tap building A directly off the splitter (output 1): building A sits
      // BEFORE the closure on fiber 1, at exactly the point the cut below
      // starts from, so the downstream walk's "sequence > cutFrom" check
      // would not otherwise pick it up — the splitter tap gives it its own
      // path into `downstream.buildings`.
      const outputPatch = await request(app)
        .patch(`/api/v1/splitters/${splitterId}/outputs/1`)
        .set(...manager)
        .send({ toBuildingId: buildingAId })
      expect(outputPatch.status).toBe(200)

      // Second fiber: fed by output 2, starting at the same closure, ending at building B.
      const created2 = await request(app)
        .post('/api/v1/fibers')
        .set(...manager)
        .send({
          zoneId: await anyZoneId(),
          coreCount: 4,
          fromSplitterOutput: { splitterId, portNo: 2 },
          points: [
            { type: 'CLOSURE', closureId, latitude: 18.515, longitude: 73.815 },
            { type: 'BUILDING', buildingId: buildingBId, latitude: 18.52, longitude: 73.82 },
          ],
        })
      expect(created2.status).toBe(201)
      const fiber2 = created2.body.data
      fiberId2 = fiber2?.id ?? null

      const getFirst = await request(app)
        .get(`/api/v1/fibers/${fiberId1}`)
        .set(...manager)
      expect(getFirst.status).toBe(200)
      expect(getFirst.body.data.splitters[0].outputs[1].toFiber.id).toBe(fiberId2)

      // A third fiber cannot reuse the same OLT PON port.
      const third = await request(app)
        .post('/api/v1/fibers')
        .set(...manager)
        .send({
          zoneId: await anyZoneId(),
          coreCount: 2,
          oltId,
          ponPort: 3,
          points: [
            { type: 'POP', popId, latitude: 18.5, longitude: 73.8 },
            { type: 'BUILDING', buildingId: buildingBId, latitude: 18.52, longitude: 73.82 },
          ],
        })
      expect(third.status).toBe(409)

      // Cutting the BUILDING(A)→CLOSURE segment takes down the direct tap
      // (building A) and fiber 2 (fed by the splitter sitting at that closure).
      const cut = await request(app)
        .post(`/api/v1/fibers/${fiberId1}/cut`)
        .set(...manager)
        .send({ segmentId: seg1 })
      expect(cut.status).toBe(200)
      expect(cut.body.data.status).toBe('CUT')
      expect(cut.body.data.downstream.buildings.map((b) => b.id)).toContain(buildingAId)
      expect(cut.body.data.downstream.fibers.map((f) => f.id)).toContain(fiberId2)

      const restore = await request(app)
        .post(`/api/v1/fibers/${fiberId1}/restore`)
        .set(...manager)
      expect(restore.status).toBe(200)
      expect(restore.body.data.status).toBe('LIVE')

      const closureGet = await request(app)
        .get(`/api/v1/closures/${closureId}`)
        .set(...manager)
      expect(closureGet.status).toBe(200)
      const roles = closureGet.body.data.fibers.map((f) => f.role)
      expect(roles).toContain('in')
      expect(roles).toContain('out')

      const del2 = await request(app)
        .delete(`/api/v1/fibers/${fiberId2}`)
        .set(...manager)
      expect(del2.status).toBe(200)
      fiberId2 = null

      const del1 = await request(app)
        .delete(`/api/v1/fibers/${fiberId1}`)
        .set(...manager)
      expect(del1.status).toBe(200)
      fiberId1 = null
    } finally {
      if (fiberId2) await request(app).delete(`/api/v1/fibers/${fiberId2}`).set(...manager)
      if (fiberId1) await request(app).delete(`/api/v1/fibers/${fiberId1}`).set(...manager)
      // Both fibers are gone by now, so no output still holds a toFiberId —
      // explicit here for defense-in-depth even though deleting the closure
      // below would cascade-delete this splitter anyway.
      if (splitterId) await request(app).delete(`/api/v1/splitters/${splitterId}`).set(...manager)
      if (closureId) await request(app).delete(`/api/v1/closures/${closureId}`).set(...manager)
      if (buildingAId) await prisma.building.delete({ where: { id: buildingAId } }).catch(() => {})
      if (buildingBId) await prisma.building.delete({ where: { id: buildingBId } }).catch(() => {})
      if (oltId) await request(app).delete(`/api/v1/pops/${popId}/olts/${oltId}`).set(...manager)
      if (popId) await request(app).delete(`/api/v1/pops/${popId}`).set(...manager)
    }
  })
})
