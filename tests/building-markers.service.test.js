import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function captureRepo(result = []) {
  const calls = []
  return {
    calls,
    listMarkers: async (where) => {
      calls.push({ where })
      return result
    },
    list: async (where) => {
      calls.push({ listWhere: where })
      return result
    },
    count: async () => result.length,
  }
}

const userRepository = { assignedZoneIds: async () => ['z-assigned'] }

// listMarkers must scope rows through the SAME buildListWhere the list uses.
// If the two ever drift, the map and the list disagree about which buildings
// exist — which is worse than the pagination bug this endpoint replaces.
describe('building service listMarkers', () => {
  it('passes the buildListWhere result straight to the repository', async () => {
    const repo = captureRepo()
    const service = createBuildingService({ buildingRepository: repo, userRepository })
    await service.listMarkers({ zoneId: 'z1', status: 'FEASIBLE', createdById: 'u1' })
    expect(repo.calls).toHaveLength(1)
    expect(repo.calls[0].where).toEqual({
      zoneId: 'z1',
      feasibleStatus: 'FEASIBLE',
      createdById: 'u1',
    })
  })

  it('builds the identical where clause the list builds', async () => {
    const filters = {
      cityId: 'c1',
      operatorId: 'op1',
      search: 'sunrise',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
    }
    const actor = { id: 'u9', role: 'MANAGER' }

    const markerRepo = captureRepo()
    await createBuildingService({ buildingRepository: markerRepo, userRepository }).listMarkers(
      filters,
      actor,
    )
    const listRepo = captureRepo()
    await createBuildingService({ buildingRepository: listRepo, userRepository }).listBuildings(
      filters,
      actor,
    )

    expect(markerRepo.calls[0].where).toEqual(listRepo.calls.find((c) => c.listWhere).listWhere)
  })

  it('applies the surveyor zone scope', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo, userRepository }).listMarkers(
      {},
      { id: 'surv-1', role: 'SURVEYOR' },
    )
    expect(repo.calls[0].where.AND).toEqual([
      { OR: [{ zoneId: { in: ['z-assigned'] } }, { createdById: 'surv-1' }] },
    ])
    expect(repo.calls[0].where.source).toBe('COVERAGE')
  })

  it('ignores page/pageSize — the map is not paginated', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo, userRepository }).listMarkers({
      page: 3,
      pageSize: 500,
    })
    expect(repo.calls[0].where).toEqual({})
  })

  it('returns the repository rows unchanged', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const repo = captureRepo(rows)
    const out = await createBuildingService({
      buildingRepository: repo,
      userRepository,
    }).listMarkers({})
    expect(out).toEqual(rows)
  })
})
