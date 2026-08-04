import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'
import { updateBuildingSchema } from '../src/modules/buildings/building.schemas.js'

const existing = { id: 'b1', buildingName: 'Old', zoneId: 'z1', createdById: 'u1' }

function makeService({ zoneExists = true } = {}) {
  const calls = []
  const service = createBuildingService({
    buildingRepository: {
      findById: async (id) => (id === 'b1' ? existing : null),
      update: async (id, data) => {
        calls.push([id, data])
        return { ...existing, ...data }
      },
    },
    storage: { keyFromUrl: () => 'key' },
    userRepository: { assignedZoneIds: async () => [] },
    zoneRepository: { findById: async () => (zoneExists ? { id: 'z2' } : null) },
  })
  return { service, calls }
}

describe('updateBuildingSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateBuildingSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a partial nested patch', () => {
    const parsed = updateBuildingSchema.parse({
      buildingName: '  New Name  ',
      details: { floors: 12 },
      permission: { amountPaid: 5000, permissionDate: '2026-08-01' },
    })
    expect(parsed.buildingName).toBe('New Name')
    expect(parsed.details).toEqual({ floors: 12 })
  })

  it('rejects location fields', () => {
    expect(updateBuildingSchema.safeParse({ latitude: 10 }).success).toBe(false)
  })
})

describe('updateBuilding', () => {
  it('404s a missing building', async () => {
    const { service } = makeService()
    await expect(service.updateBuilding('nope', { buildingName: 'X' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('400s a zone change to an unknown zone', async () => {
    const { service } = makeService({ zoneExists: false })
    await expect(service.updateBuilding('b1', { zoneId: 'z9' })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('upserts nested details and permission, converting dates', async () => {
    const { service, calls } = makeService()
    await service.updateBuilding('b1', {
      buildingName: 'New',
      details: { floors: 12, remarks: null },
      permission: { permissionDate: '2026-08-01', renewalDate: null, ownerName: 'Amit' },
    })
    const [, data] = calls[0]
    expect(data.buildingName).toBe('New')
    expect(data.details.upsert.update).toEqual({ floors: 12, remarks: null })
    expect(data.permission.upsert.update.ownerName).toBe('Amit')
    expect(data.permission.upsert.update.permissionDate).toBeInstanceOf(Date)
    expect(data.permission.upsert.update.renewalDate).toBeNull()
  })
})
