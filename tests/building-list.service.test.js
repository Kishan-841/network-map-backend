import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function captureRepo(result = [], total = result.length) {
  const calls = []
  return {
    calls,
    list: async (where, options) => {
      calls.push({ where, options })
      return result
    },
    count: async (where) => {
      calls.push({ countWhere: where })
      return total
    },
  }
}

describe('building service listBuildings filters', () => {
  it('passes an empty where when no filters given', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({})
    expect(repo.calls.find((c) => c.where).where).toEqual({})
  })

  it('builds zone/status/surveyor filters', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({
      zoneId: 'z1',
      status: 'FEASIBLE',
      createdById: 'u1',
    })
    expect(repo.calls.find((c) => c.where).where).toEqual({
      zoneId: 'z1',
      feasibleStatus: 'FEASIBLE',
      createdById: 'u1',
    })
  })

  it('builds a createdAt range from dateFrom/dateTo', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
    })
    const range = repo.calls.find((c) => c.where).where.createdAt
    expect(range.gte).toEqual(new Date('2026-07-01'))
    expect(range.lte).toEqual(new Date('2026-07-22T23:59:59.999Z'))
  })

  it('builds an OR search over name, address, and zone name', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({ search: 'sunrise' })
    expect(repo.calls.find((c) => c.where).where.OR).toEqual([
      { buildingName: { contains: 'sunrise', mode: 'insensitive' } },
      { formattedAddress: { contains: 'sunrise', mode: 'insensitive' } },
      { zone: { name: { contains: 'sunrise', mode: 'insensitive' } } },
    ])
  })

  it('paginates at the database level and returns pagination meta', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const repo = captureRepo(rows, 45)
    const result = await createBuildingService({ buildingRepository: repo }).listBuildings({
      page: 3,
      pageSize: 20,
    })

    const listCall = repo.calls.find((c) => c.options)
    expect(listCall.options).toEqual({ skip: 40, take: 20 })
    expect(result.items).toEqual(rows)
    expect(result.pagination).toEqual({ page: 3, pageSize: 20, total: 45, totalPages: 3 })
  })

  it('defaults to page 1 with pageSize 20', async () => {
    const repo = captureRepo([], 0)
    const result = await createBuildingService({ buildingRepository: repo }).listBuildings({})
    const listCall = repo.calls.find((c) => c.options)
    expect(listCall.options).toEqual({ skip: 0, take: 20 })
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
  })

  it('radius filter: bounding box in where, haversine post-filter, in-memory pagination', async () => {
    const inside = { id: 'a', latitude: 19.0761, longitude: 72.8777 }
    const corner = { id: 'b', latitude: 19.0769, longitude: 72.8786 } // in box, ~130 m away
    const repo = captureRepo([inside, corner])
    const result = await createBuildingService({ buildingRepository: repo }).listBuildings({
      latitude: 19.076,
      longitude: 72.8777,
      radius: 100,
    })
    expect(repo.calls[0].where.latitude.gte).toBeCloseTo(19.0751, 3)
    expect(result.items.map((r) => r.id)).toEqual(['a'])
    expect(result.pagination.total).toBe(1)
  })
})
