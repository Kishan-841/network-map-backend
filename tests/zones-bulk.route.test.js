import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('POST /api/v1/zones/bulk', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).post('/api/v1/zones/bulk').send({ zones: [] })
    expect(res.status).toBe(401)
  })

  it('rejects SURVEYOR', async () => {
    const res = await request(createApp())
      .post('/api/v1/zones/bulk')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
      .send({ zones: [{ name: 'X', city: 'Y' }] })
    expect(res.status).toBe(403)
  })

  it('rejects an invalid body', async () => {
    const res = await request(createApp())
      .post('/api/v1/zones/bulk')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({ zones: [] })
    expect(res.status).toBe(400)
  })

  it('creates new zones, skips repeats, and writes one audit entry', async () => {
    const stamp = Date.now()
    const nameA = `BulkA-${stamp}`
    const nameB = `BulkB-${stamp}`
    const payload = { zones: [{ name: nameA, city: 'Pune' }, { name: nameB, city: 'Pune' }] }
    const auth = ['Authorization', `Bearer ${tokenFor('ADMIN')}`]

    const first = await request(createApp()).post('/api/v1/zones/bulk').set(...auth).send(payload)
    expect(first.status).toBe(200)
    expect(first.body.data.created).toHaveLength(2)
    expect(first.body.data.skipped).toHaveLength(0)
    expect(first.body.data.total).toBe(2)

    // Idempotent re-upload: everything skips.
    const second = await request(createApp()).post('/api/v1/zones/bulk').set(...auth).send(payload)
    expect(second.status).toBe(200)
    expect(second.body.data.created).toHaveLength(0)
    expect(second.body.data.skipped).toEqual([
      { name: nameA, reason: 'already exists' },
      { name: nameB, reason: 'already exists' },
    ])

    // One BulkCreate audit entry per import (2 imports above).
    await vi.waitFor(async () => {
      const entries = await prisma.systemLog.findMany({
        where: { module: 'Zone', action: 'BulkCreate' },
        orderBy: { createdAt: 'desc' },
        take: 2,
      })
      expect(entries).toHaveLength(2)
      expect(entries[1].description).toBe('Bulk zone import: 2 created, 0 skipped')
      expect(entries[0].description).toBe('Bulk zone import: 0 created, 2 skipped')
    })

    // Cleanup the zones this test created (they have no buildings).
    await prisma.zone.deleteMany({ where: { name: { in: [nameA, nameB] } } })
  })
})
