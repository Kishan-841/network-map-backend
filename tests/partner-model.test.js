import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '../src/lib/prisma.js'

const STAMP = `pm${Date.now()}`
afterAll(async () => {
  await prisma.partner.deleteMany({ where: { email: { contains: STAMP } } })
  await prisma.$disconnect()
})

describe('Partner model', () => {
  it('starts REGISTERED — a new partner can do nothing commercial yet', async () => {
    const p = await prisma.partner.create({
      data: {
        name: 'Test Partner', type: 'RETAIL_SHOP',
        mobile: '9000000001', email: `${STAMP}@t.local`, passwordHash: 'x',
      },
    })
    expect(p.status).toBe('REGISTERED')
    expect(p.hasGst).toBe(false)
    expect(p.onboardedById).toBeNull()
  })

  it('requires a unique email', async () => {
    const data = {
      name: 'Dup', type: 'DSA', mobile: '9000000002',
      email: `dup-${STAMP}@t.local`, passwordHash: 'x',
    }
    await prisma.partner.create({ data })
    await expect(prisma.partner.create({ data })).rejects.toThrow()
  })

  it('holds one current document per type, replaced on re-upload', async () => {
    const p = await prisma.partner.create({
      data: {
        name: 'Docs', type: 'AGENT', mobile: '9000000003',
        email: `docs-${STAMP}@t.local`, passwordHash: 'x',
      },
    })
    await prisma.partnerDocument.create({
      data: { partnerId: p.id, type: 'AADHAAR', url: 'https://cdn/uploads/a.jpg' },
    })
    await expect(
      prisma.partnerDocument.create({
        data: { partnerId: p.id, type: 'AADHAAR', url: 'https://cdn/uploads/b.jpg' },
      }),
    ).rejects.toThrow()
  })

  it('cascades documents when a partner is deleted', async () => {
    const p = await prisma.partner.create({
      data: {
        name: 'Casc', type: 'DSA', mobile: '9000000004',
        email: `casc-${STAMP}@t.local`, passwordHash: 'x',
        documents: { create: [{ type: 'PAN', url: 'https://cdn/uploads/p.jpg' }] },
      },
    })
    await prisma.partner.delete({ where: { id: p.id } })
    expect(await prisma.partnerDocument.count({ where: { partnerId: p.id } })).toBe(0)
  })
})
