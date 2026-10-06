import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * The Splitters page: a list of every splitter the reader may see, and one
 * splitter in full. Same zone rule as closures — the maker, anyone holding the
 * zone of the fiber it sits on, and ADMIN; anyone else reads a 404.
 */
const app = createApp()
const stamp = Date.now()
const as = (sub, role) => ({
  Authorization: `Bearer ${jwt.sign({ sub, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
})
const ADMIN = as('test-admin', 'ADMIN')
const OWNER = as('test-surveyor', 'SURVEYOR')
const STRANGER = as('test-edit-surveyor', 'SURVEYOR')

let closure
let splitter

beforeAll(async () => {
  closure = await prisma.closure.create({
    data: { code: `JC-T${stamp}`, latitude: 18.52, longitude: 73.85, createdById: 'test-surveyor' },
  })
  splitter = await prisma.splitter.create({
    data: {
      code: `ST${stamp}`,
      latitude: 18.52,
      longitude: 73.85,
      closureId: closure.id,
      ratio: 'R1_4',
      location: 'S2',
      createdById: 'test-surveyor',
      outputs: { create: [1, 2, 3, 4].map((portNo) => ({ portNo, label: portNo === 2 ? 'Tower B' : null })) },
    },
  })
})
afterAll(async () => {
  await prisma.closure.deleteMany({ where: { id: closure.id } }) // cascades the splitter + outputs
})

describe('GET /splitters', () => {
  it('lists the splitter for ADMIN with where it sits and port use', async () => {
    const res = await request(app).get('/api/v1/splitters').set(ADMIN)
    expect(res.status).toBe(200)
    const row = res.body.data.find((s) => s.id === splitter.id)
    expect(row).toMatchObject({
      code: splitter.code,
      ratio: 'R1_4',
      location: 'S2',
      closure: { id: closure.id, code: closure.code },
      portsTotal: 4,
      portsUsed: 0,
    })
  })

  it('lists it for its maker', async () => {
    const res = await request(app).get('/api/v1/splitters').set(OWNER)
    expect(res.body.data.some((s) => s.id === splitter.id)).toBe(true)
  })

  it('hides it from someone outside its zone', async () => {
    const res = await request(app).get('/api/v1/splitters').set(STRANGER)
    expect(res.status).toBe(200)
    expect(res.body.data.some((s) => s.id === splitter.id)).toBe(false)
  })

  it('is refused to roles that cannot read the network', async () => {
    const res = await request(app).get('/api/v1/splitters').set(as('cmt2ih9yw0005rte03bbriz46', 'ACQUISITION_AGENT'))
    expect(res.status).toBe(403)
  })
})

describe('GET /splitters/:id', () => {
  it('returns every output port in order, with who added it', async () => {
    const res = await request(app).get(`/api/v1/splitters/${splitter.id}`).set(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.data.outputs.map((o) => o.portNo)).toEqual([1, 2, 3, 4])
    expect(res.body.data.outputs[1].label).toBe('Tower B')
    expect(res.body.data.closure.code).toBe(closure.code)
    expect(res.body.data.createdBy.id).toBe('test-surveyor')
  })

  it('answers 404 to someone outside its zone, and for an unknown id', async () => {
    expect((await request(app).get(`/api/v1/splitters/${splitter.id}`).set(STRANGER)).status).toBe(404)
    expect((await request(app).get('/api/v1/splitters/nope').set(ADMIN)).status).toBe(404)
  })
})
