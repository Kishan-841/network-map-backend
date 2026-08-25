import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

/**
 * SUPERVISOR: oversight across BOTH registries. Sees every building whoever
 * logged it, and may add or edit any of them — but is not an administrator.
 *
 * The property under test is "all means all": no source filter is ever applied
 * for this role, so nothing quietly falls out of its view.
 */

const COVERAGE = {
  id: 'cov1',
  buildingName: 'Coverage Tower',
  latitude: 18.5311,
  longitude: 73.8611,
  zoneId: 'z1',
  source: 'COVERAGE',
  createdById: 'surveyor-1',
}
const ACQ = {
  id: 'acq1',
  buildingName: 'Acquisition House',
  latitude: 18.5312,
  longitude: 73.8612,
  zoneId: null,
  source: 'ACQUISITION',
  createdById: 'agent-1',
}

const SUPERVISOR = { id: 'sup1', role: 'SUPERVISOR' }
const MANAGER = { id: 'mgr1', role: 'MANAGER' }

const fakeUserRepo = () => ({ assignedZoneIds: async () => [], assignedPincodes: async () => [] })

function fakeRepo(buildings = [COVERAGE, ACQ]) {
  const calls = []
  return {
    calls,
    list: vi.fn(async (where) => (calls.push(where), buildings)),
    count: vi.fn(async (where) => (calls.push(where), buildings.length)),
    findById: vi.fn(async (id) => buildings.find((b) => b.id === id) ?? null),
    findWithinBounds: async () => buildings,
    findByPlaceId: async () => null,
    createPhoto: vi.fn(async (d) => ({ id: 'p1', ...d })),
    upsertPermissionDocument: vi.fn(async () => {}),
    create: vi.fn(async (d) => ({ id: 'new', ...d })),
    updateMany: vi.fn(async () => ({ count: 2 })),
  }
}

const build = (buildings) => {
  const repo = fakeRepo(buildings)
  return {
    repo,
    service: createBuildingService({
      buildingRepository: repo,
      storage: { keyFromUrl: (u) => (u?.includes('/uploads/') ? 'k' : null) },
      userRepository: fakeUserRepo(),
    }),
  }
}

describe('SUPERVISOR sees both registries', () => {
  it('applies no source filter at all', async () => {
    const { repo, service } = build()
    await service.listBuildings({}, SUPERVISOR)
    expect(repo.calls[0].source).toBeUndefined()
  })

  it('still scopes a manager to the coverage registry', async () => {
    const { repo, service } = build()
    await service.listBuildings({}, MANAGER)
    expect(repo.calls[0].source).toBe('COVERAGE')
  })

  it('matches a city through either mapping, since both registries are in view', async () => {
    const { repo, service } = build()
    await service.listBuildings({ cityId: 'c1' }, SUPERVISOR)
    // Acquisition rows carry cityId directly; coverage rows reach it through
    // zone → operator. Picking one would silently hide the other half.
    expect(repo.calls[0].AND).toEqual([
      { OR: [{ cityId: 'c1' }, { zone: { operator: { cityId: 'c1' } } }] },
    ])
  })

  it('leaves the manager city filter on the coverage path', async () => {
    const { repo, service } = build()
    await service.listBuildings({ cityId: 'c1' }, MANAGER)
    expect(repo.calls[0].zone).toEqual({ operator: { cityId: 'c1' } })
    expect(repo.calls[0].AND).toBeUndefined()
  })

  it('opens any building regardless of who logged it', async () => {
    const { service } = build()
    expect((await service.getBuilding('cov1', SUPERVISOR)).id).toBe('cov1')
    expect((await service.getBuilding('acq1', SUPERVISOR)).id).toBe('acq1')
  })

  it('sees nearby buildings unmasked, both registries', async () => {
    const { service } = build()
    const near = await service.findNearby(
      { latitude: 18.5311, longitude: 73.8611, radiusMeters: 500 },
      SUPERVISOR,
    )
    expect(near.every((b) => !b.masked)).toBe(true)
    expect(near.map((b) => b.buildingName).sort()).toEqual([
      'Acquisition House',
      'Coverage Tower',
    ])
  })
})

describe('SUPERVISOR may edit anything it can see', () => {
  it('adds a photo to a building someone else logged', async () => {
    const { repo, service } = build()
    await service.addPhoto('acq1', { type: 'ADDITIONAL', url: '/uploads/x.jpg' }, SUPERVISOR)
    expect(repo.createPhoto).toHaveBeenCalled()
  })

  it('may upload a permission letter, like a manager', async () => {
    const { repo, service } = build()
    await service.addPhoto(
      'cov1',
      { type: 'PERMISSION_LETTER', url: '/uploads/l.pdf' },
      SUPERVISOR,
    )
    expect(repo.upsertPermissionDocument).toHaveBeenCalled()
  })

  it('creates a coverage building', async () => {
    const { service } = build()
    const created = await service.createBuilding(
      { buildingName: 'New', formattedAddress: 'x', latitude: 1, longitude: 1, zoneId: 'z1' },
      SUPERVISOR.id,
      SUPERVISOR,
    )
    expect(created.buildingName).toBe('New')
  })

  it('marks buildings live in bulk across both registries', async () => {
    const { repo, service } = build()
    await service.bulkSetLive({ filter: {}, isLive: true }, SUPERVISOR)
    expect(repo.updateMany.mock.calls[0][0].source).toBeUndefined()
  })
})
