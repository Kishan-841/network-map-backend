import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function fakeBuildingRepository(seed = []) {
  const buildings = [...seed]
  return {
    buildings,
    create: async (data) => {
      const building = { id: `b-${buildings.length + 1}`, ...data }
      buildings.push(building)
      return building
    },
    list: async () => buildings,
    findById: async (id) => buildings.find((b) => b.id === id) ?? null,
  }
}

const fakeStorage = {
  keyFromUrl: (url) => (url.includes('/uploads/') ? url.split('/uploads/')[1] : null),
}

describe('building service', () => {
  it('creates a building with nested details/permission/photos and the creator id', async () => {
    const repo = fakeBuildingRepository()
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage })

    await service.createBuilding(
      {
        placeId: 'way:123',
        buildingName: 'Sunrise Apartments',
        formattedAddress: '12 Main St',
        latitude: 19.1,
        longitude: 72.9,
        zoneId: 'zone-1',
        details: { wings: 2, floors: 10 },
        permission: { amountPaid: 5000 },
        photos: [{ type: 'ENTRANCE', url: '/uploads/a.jpg' }],
      },
      'user-9',
    )

    const created = repo.buildings[0]
    expect(created.createdById).toBe('user-9')
    // Adding a building means it was surveyed and is viable (user decision).
    expect(created.feasibleStatus).toBe('FEASIBLE')
    expect(created.surveyStatus).toBe('COMPLETED')
    expect(created.details).toEqual({ create: { wings: 2, floors: 10 } })
    expect(created.permission).toEqual({ create: { amountPaid: 5000 } })
    expect(created.photos).toEqual({ create: [{ type: 'ENTRANCE', url: '/uploads/a.jpg' }] })
    expect(created.buildingName).toBe('Sunrise Apartments')
  })

  it('omits nested writes that were not provided', async () => {
    const repo = fakeBuildingRepository()
    const service = createBuildingService({ buildingRepository: repo })

    await service.createBuilding(
      {
        buildingName: 'Lone House',
        formattedAddress: 'Nowhere 1',
        latitude: 1,
        longitude: 2,
        zoneId: 'zone-1',
      },
      'user-1',
    )

    const created = repo.buildings[0]
    expect(created.details).toBeUndefined()
    expect(created.permission).toBeUndefined()
    expect(created.photos).toBeUndefined()
  })

  it('throws 404 for an unknown building id', async () => {
    const service = createBuildingService({ buildingRepository: fakeBuildingRepository() })
    await expect(service.getBuilding('missing')).rejects.toMatchObject({ status: 404 })
  })

  it('updates feasible and survey status', async () => {
    const repo = fakeBuildingRepository([
      { id: 'b1', feasibleStatus: 'SURVEY_PENDING', surveyStatus: 'PENDING' },
    ])
    repo.update = async (id, data) => {
      const building = repo.buildings.find((b) => b.id === id)
      Object.assign(building, data)
      return building
    }
    const service = createBuildingService({ buildingRepository: repo })
    const updated = await service.updateStatus('b1', {
      feasibleStatus: 'FEASIBLE',
      surveyStatus: 'COMPLETED',
    })
    expect(updated.feasibleStatus).toBe('FEASIBLE')
    expect(updated.surveyStatus).toBe('COMPLETED')
  })

  it('404s updating status of an unknown building', async () => {
    const service = createBuildingService({ buildingRepository: fakeBuildingRepository() })
    await expect(
      service.updateStatus('missing', { feasibleStatus: 'FEASIBLE' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('stores isLive on create', async () => {
    const repo = fakeBuildingRepository()
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage })
    await service.createBuilding(
      {
        buildingName: 'Live Tower',
        formattedAddress: '1 Fiber Rd',
        latitude: 1,
        longitude: 2,
        zoneId: 'z1',
        isLive: true,
      },
      'u1',
    )
    expect(repo.buildings[0].isLive).toBe(true)
  })

  it('toggles isLive via updateStatus (including false)', async () => {
    const repo = fakeBuildingRepository([{ id: 'b1', isLive: false }])
    repo.update = async (id, data) => {
      const building = repo.buildings.find((b) => b.id === id)
      Object.assign(building, data)
      return building
    }
    const service = createBuildingService({ buildingRepository: repo })
    expect((await service.updateStatus('b1', { isLive: true })).isLive).toBe(true)
    expect((await service.updateStatus('b1', { isLive: false })).isLive).toBe(false)
  })
})
