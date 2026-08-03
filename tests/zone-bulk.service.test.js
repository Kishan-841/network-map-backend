import { describe, it, expect } from 'vitest'
import { createZoneService } from '../src/modules/zones/zone.service.js'
import { bulkZoneSchema } from '../src/modules/zones/zone.schemas.js'

function fakeZoneRepository(existingNames = []) {
  const created = []
  return {
    created,
    findByName: async (name) =>
      existingNames.includes(name) ? { id: `existing-${name}`, name } : null,
    create: async (data) => {
      const zone = { id: `z${created.length + 1}`, boundary: null, ...data }
      created.push(zone)
      return zone
    },
  }
}

describe('bulkZoneSchema', () => {
  it('rejects an empty zones array', () => {
    expect(bulkZoneSchema.safeParse({ zones: [] }).success).toBe(false)
  })

  it('rejects more than 500 rows', () => {
    const zones = Array.from({ length: 501 }, (_, i) => ({ name: `Z${i}`, city: 'Pune' }))
    expect(bulkZoneSchema.safeParse({ zones }).success).toBe(false)
  })

  it('trims and accepts valid rows', () => {
    const parsed = bulkZoneSchema.parse({ zones: [{ name: '  Wakad  ', city: ' Pune ' }] })
    expect(parsed.zones[0]).toEqual({ name: 'Wakad', city: 'Pune' })
  })

  it('rejects blank names', () => {
    expect(bulkZoneSchema.safeParse({ zones: [{ name: '   ', city: 'Pune' }] }).success).toBe(false)
  })
})

describe('bulkCreateZones', () => {
  it('creates new zones and reports them', async () => {
    const repo = fakeZoneRepository()
    const service = createZoneService({ zoneRepository: repo })
    const result = await service.bulkCreateZones([
      { name: 'Wakad West', city: 'Pune' },
      { name: 'Baner', city: 'Pune' },
    ])
    expect(result.created).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)
    expect(result.total).toBe(2)
    expect(repo.created.map((z) => z.name)).toEqual(['Wakad West', 'Baner'])
  })

  it('skips names that already exist in the DB', async () => {
    const repo = fakeZoneRepository(['Baner'])
    const service = createZoneService({ zoneRepository: repo })
    const result = await service.bulkCreateZones([
      { name: 'Baner', city: 'Pune' },
      { name: 'Aundh', city: 'Pune' },
    ])
    expect(result.created.map((z) => z.name)).toEqual(['Aundh'])
    expect(result.skipped).toEqual([{ name: 'Baner', reason: 'already exists' }])
    expect(result.total).toBe(2)
  })

  it('first occurrence wins for duplicates within the file', async () => {
    const repo = fakeZoneRepository()
    const service = createZoneService({ zoneRepository: repo })
    const result = await service.bulkCreateZones([
      { name: 'Wakad', city: 'Pune' },
      { name: 'Wakad', city: 'Mumbai' },
    ])
    expect(result.created).toHaveLength(1)
    expect(result.created[0].city).toBe('Pune')
    expect(result.skipped).toEqual([{ name: 'Wakad', reason: 'duplicate in file' }])
  })
})
