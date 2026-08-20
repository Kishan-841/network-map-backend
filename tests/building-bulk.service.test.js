import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

const ROW = (over = {}) => ({
  buildingName: 'Balaji Heights',
  latitude: 18.523956,
  longitude: 73.861517,
  zone: 'Mangalwar Peth',
  operator: 'Fiber Plus Broadband',
  homePass: 50,
  remark: 'SERVER',
  ...over,
})

function fakes({ zones = [], operators = [], existingBuilding = null } = {}) {
  const state = { zones: [...zones], operators: [...operators], created: [] }
  let seq = 0
  return {
    state,
    buildingRepository: {
      findByNameInZone: vi.fn(async () => existingBuilding),
      create: vi.fn(async (data) => {
        state.created.push(data)
        return { id: `b${++seq}`, ...data }
      }),
    },
    zoneRepository: {
      listAll: async () => state.zones,
      create: vi.fn(async (data) => {
        const zone = { id: `z${state.zones.length + 1}`, ...data }
        state.zones.push(zone)
        return zone
      }),
      update: vi.fn(async (id, data) => {
        const zone = state.zones.find((z) => z.id === id)
        Object.assign(zone, data)
        return zone
      }),
    },
    operatorRepository: {
      listAll: async () => state.operators,
      create: vi.fn(async (data) => {
        const op = { id: `op${state.operators.length + 1}`, ...data }
        state.operators.push(op)
        return op
      }),
    },
    storage: { keyFromUrl: () => 'k' },
  }
}

describe('bulkCreateBuildings', () => {
  it('creates zone, operator, and building with details from a fresh row', async () => {
    const deps = fakes()
    const service = createBuildingService(deps)
    const result = await service.bulkCreateBuildings([ROW()], 'admin1')
    expect(result.createdCount).toBe(1)
    expect(result.zonesCreated).toBe(1)
    expect(result.operatorsCreated).toBe(1)
    const created = deps.state.created[0]
    expect(created.zoneId).toBe('z1')
    expect(created.createdById).toBe('admin1')
    expect(created.details.create.homePass).toBe(50)
    expect(created.details.create.remarks).toBe('SERVER')
    // The new zone is linked to the new operator.
    expect(deps.state.zones[0].operatorId).toBe('op1')
  })

  it('reuses existing zones/operators (case-insensitive) and links unlinked zones', async () => {
    const deps = fakes({
      zones: [{ id: 'z9', name: 'MANGALWAR PETH', operatorId: null }],
      operators: [{ id: 'op9', name: 'FIBER PLUS BROADBAND' }],
    })
    const service = createBuildingService(deps)
    const result = await service.bulkCreateBuildings([ROW()], 'admin1')
    expect(result.zonesCreated).toBe(0)
    expect(result.operatorsCreated).toBe(0)
    expect(deps.zoneRepository.update).toHaveBeenCalledWith('z9', { operatorId: 'op9' })
    expect(deps.state.created[0].zoneId).toBe('z9')
  })

  it('skips duplicates in the file and buildings already in the zone', async () => {
    const deps = fakes()
    const service = createBuildingService(deps)
    const result = await service.bulkCreateBuildings([ROW(), ROW()], 'admin1')
    expect(result.createdCount).toBe(1)
    expect(result.skipped).toEqual([
      { row: 2, buildingName: 'Balaji Heights', reason: 'duplicate in file' },
    ])

    const deps2 = fakes({ existingBuilding: { id: 'b0' } })
    const result2 = await createBuildingService(deps2).bulkCreateBuildings([ROW()], 'admin1')
    expect(result2.createdCount).toBe(0)
    expect(result2.skipped[0].reason).toBe('already exists in zone')
  })

  it('rows without operator or details create a bare building', async () => {
    const deps = fakes()
    const service = createBuildingService(deps)
    await service.bulkCreateBuildings(
      [ROW({ operator: null, homePass: null, remark: null })],
      'admin1',
    )
    const created = deps.state.created[0]
    expect(created.details).toBeUndefined()
    expect(deps.state.zones[0].operatorId).toBeUndefined()
  })
})
