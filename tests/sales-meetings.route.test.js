import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const token = (id, role) => jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
const auth = (id, role) => ({ Authorization: `Bearer ${token(id, role)}` })

const S = `mtg-${Date.now()}`
const MGR = `${S}-mgr`
const MGR2 = `${S}-mgr2`
const TL = `${S}-tl`
const TL2 = `${S}-tl2`
const SE = `${S}-se`

const meetingIdsFor = async (tlIds) =>
  prisma.teamMeeting.findMany({ where: { teamLeaderId: { in: tlIds } }, select: { id: true } })

beforeAll(async () => {
  await prisma.user.create({ data: { id: MGR, name: MGR, email: `${MGR}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: MGR2, name: MGR2, email: `${MGR2}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: TL, name: TL, email: `${TL}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR } })
  await prisma.user.create({ data: { id: TL2, name: TL2, email: `${TL2}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR2 } })
  await prisma.user.create({ data: { id: SE, name: SE, email: `${SE}@v.local`, passwordHash: 'x', role: 'SALES_EXECUTIVE', managerId: MGR, teamLeaderId: TL } })
})
afterAll(async () => {
  await prisma.teamMeeting.deleteMany({ where: { teamLeaderId: { in: [TL, TL2] } } })
  await prisma.user.deleteMany({ where: { id: { in: [MGR, MGR2, TL, TL2, SE] } } })
})

const body = { photoUrl: 'https://r2.example/mtg.jpg', latitude: 18.52, longitude: 73.85, note: 'All present' }

describe('team-leader morning meetings', () => {
  it('a team leader logs a meeting (201), and re-logging the same day replaces it', async () => {
    const first = await request(app).post('/api/v1/sales/meetings').set(auth(TL, 'TEAM_LEADER')).send(body)
    expect(first.status).toBe(201)
    const again = await request(app)
      .post('/api/v1/sales/meetings')
      .set(auth(TL, 'TEAM_LEADER'))
      .send({ ...body, note: 'Updated', photoUrl: 'https://r2.example/mtg2.jpg' })
    expect(again.status).toBe(201)
    // Still one row for the day, with the new photo/note.
    const rows = await meetingIdsFor([TL])
    expect(rows).toHaveLength(1)
    expect(again.body.data.photoUrl).toBe('https://r2.example/mtg2.jpg')
    expect(again.body.data.note).toBe('Updated')
    expect(again.body.data.teamLeader.id).toBe(TL)
  })

  it('an executive cannot log a meeting (403) and cannot read the list (403)', async () => {
    expect((await request(app).post('/api/v1/sales/meetings').set(auth(SE, 'SALES_EXECUTIVE')).send(body)).status).toBe(403)
    expect((await request(app).get('/api/v1/sales/meetings').set(auth(SE, 'SALES_EXECUTIVE'))).status).toBe(403)
  })

  it('the manager sees their team leader\'s meeting; the TL sees their own', async () => {
    const mgr = await request(app).get('/api/v1/sales/meetings').set(auth(MGR, 'SALES_MANAGER'))
    expect(mgr.status).toBe(200)
    expect(mgr.body.data.map((m) => m.teamLeader.id)).toContain(TL)

    const tl = await request(app).get('/api/v1/sales/meetings').set(auth(TL, 'TEAM_LEADER'))
    expect(tl.status).toBe(200)
    expect(tl.body.data.every((m) => m.teamLeader.id === TL)).toBe(true)
  })

  it("a different manager does NOT see another team's meeting", async () => {
    const other = await request(app).get('/api/v1/sales/meetings').set(auth(MGR2, 'SALES_MANAGER'))
    expect(other.body.data.map((m) => m.teamLeader.id)).not.toContain(TL)
  })
})
