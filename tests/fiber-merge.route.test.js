import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, {
    audience: 'staff',
    expiresIn: '1h',
  })

// A patch of map no other test draws on, so the junction sweep (which reads
// every fiber in the database) cannot pick up a neighbour's leftovers.
const LAT = 12.3456
const LON = 77.7788
const METERS_PER_DEGREE = (6371000 * Math.PI) / 180
const north = (meters) => LAT + meters / METERS_PER_DEGREE

const waypoint = (latitude, longitude = LON) => ({ type: 'WAYPOINT', latitude, longitude })

describe('fiber merge-points API', () => {
  it('finds a junction of two migrated loose ends and merges them into one closure', async () => {
    const app = createApp()
    const stamp = Date.now()
    const manager = ['Authorization', `Bearer ${tokenFor('MANAGER')}`]

    let fiberId1 = null
    let fiberId2 = null
    let closureId = null

    try {
      // Two phase-1 style routes: every point a WAYPOINT, so neither has any
      // segment yet, and their far ends land 3 m apart on the same pole.
      const created1 = await request(app)
        .post('/api/v1/fibers')
        .set(...manager)
        .send({
          name: `FIB-MERGE-A-${stamp}`,
          coreCount: 6,
          points: [waypoint(north(-200)), waypoint(north(0))],
        })
      expect(created1.status).toBe(201)
      fiberId1 = created1.body.data.id
      const end1 = created1.body.data.points[1].id

      const created2 = await request(app)
        .post('/api/v1/fibers')
        .set(...manager)
        .send({
          name: `FIB-MERGE-B-${stamp}`,
          coreCount: 6,
          points: [waypoint(north(200)), waypoint(north(3))],
        })
      expect(created2.status).toBe(201)
      fiberId2 = created2.body.data.id
      const end2 = created2.body.data.points[1].id

      expect(created1.body.data.segments).toHaveLength(0)
      expect(created2.body.data.segments).toHaveLength(0)

      const junctions = await request(app)
        .get('/api/v1/fibers/junctions?radius=10')
        .set(...manager)
      expect(junctions.status).toBe(200)
      const cluster = junctions.body.data.find((c) => c.points.some((p) => p.pointId === end1))
      expect(cluster).toBeTruthy()
      expect(cluster.points.map((p) => p.pointId).sort()).toEqual([end1, end2].sort())
      expect(cluster.points.map((p) => p.fiberName).sort()).toEqual(
        [`FIB-MERGE-A-${stamp}`, `FIB-MERGE-B-${stamp}`].sort(),
      )
      expect(cluster.centre.latitude).toBeCloseTo((north(0) + north(3)) / 2, 8)

      // 'junctions' must not be read as a fiber id by the '/:id' route below it.
      expect(junctions.body.data).toBeInstanceOf(Array)

      const merged = await request(app)
        .post('/api/v1/fibers/merge-points')
        .set(...manager)
        .send({ pointIds: [end1, end2], type: 'CLOSURE', kind: 'pole' })
      expect(merged.status).toBe(201)
      closureId = merged.body.data.entity.id
      expect(merged.body.data.entity.type).toBe('CLOSURE')
      expect(merged.body.data.entity.code).toMatch(/^CL-\d{4}$/)
      expect(merged.body.data.fibers.map((f) => f.id).sort()).toEqual([fiberId1, fiberId2].sort())

      const code = merged.body.data.entity.code
      for (const id of [fiberId1, fiberId2]) {
        const got = await request(app)
          .get(`/api/v1/fibers/${id}`)
          .set(...manager)
        expect(got.status).toBe(200)
        const last = got.body.data.points.at(-1)
        expect(last.type).toBe('CLOSURE')
        expect(last.closureId).toBe(closureId)
        expect(last.label).toBe(code)
      }

      const closure = await request(app)
        .get(`/api/v1/closures/${closureId}`)
        .set(...manager)
      expect(closure.status).toBe(200)
      expect(closure.body.data.fibers.map((f) => f.id).sort()).toEqual([fiberId1, fiberId2].sort())
      expect(closure.body.data.fibers.map((f) => f.role)).toEqual(['in', 'in'])
    } finally {
      if (fiberId1) await request(app).delete(`/api/v1/fibers/${fiberId1}`).set(...manager)
      if (fiberId2) await request(app).delete(`/api/v1/fibers/${fiberId2}`).set(...manager)
      if (closureId) await request(app).delete(`/api/v1/closures/${closureId}`).set(...manager)
    }
  })
})
