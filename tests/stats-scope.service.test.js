import { describe, it, expect } from 'vitest'
import { createStatsService } from '../src/modules/stats/stats.service.js'

function fakeStatsRepo() {
  const wheres = {}
  const calls = { byOperator: 0, overTime: 0 }
  return {
    wheres,
    calls,
    countBuildings: async (where) => ((wheres.count = where), 5),
    countsByStatus: async (where) => ((wheres.status = where), []),
    countsByLive: async (where) => ((wheres.live = where), []),
    sumHomePass: async (where) => ((wheres.homePass = where), 10),
    sumPermissionCost: async (where) => ((wheres.cost = where), 0),
    countOperators: async () => 7,
    countZones: async (where) => ((wheres.zone = where), 42),
    buildingsByOperator: async () => {
      calls.byOperator++
      return [{ operatorId: 'op1', name: 'Op1', buildings: 3, homePass: 30 }]
    },
    buildingsOverTime: async (args) => {
      calls.overTime++
      wheres.overTime = args
      return [{ date: '2026-08-01', count: 2 }]
    },
  }
}

const fakeUserRepo = (zones = ['z1']) => ({ assignedZoneIds: async () => zones })

const SURVEYOR_SCOPE = {
  OR: [{ zoneId: { in: ['z1'] } }, { createdById: 'u-surv' }],
}

describe('dashboard stats scoping', () => {
  it('passes no building filter for admins and computes charts', async () => {
    const repo = fakeStatsRepo()
    const result = await createStatsService({ statsRepository: repo }).getDashboardStats({
      id: 'a',
      role: 'ADMIN',
    })
    expect(repo.wheres.count).toBeUndefined()
    expect(result.operatorCount).toBe(7)
    expect(result.zoneCount).toBe(42)
    expect(repo.wheres.zone).toEqual({}) // no operator → all zones
    expect(result.byOperator).toHaveLength(1)
    expect(result.byOperator[0].homePass).toBe(30)
    expect(result.overTime).toHaveLength(1)
  })

  it('scopes all KPI queries to assigned zones + own and omits charts', async () => {
    const repo = fakeStatsRepo()
    const result = await createStatsService({
      statsRepository: repo,
      userRepository: fakeUserRepo(['z1']),
    }).getDashboardStats({ id: 'u-surv', role: 'SURVEYOR' })
    expect(repo.wheres.count).toEqual(SURVEYOR_SCOPE)
    expect(repo.wheres.homePass).toEqual({ building: SURVEYOR_SCOPE })
    // Charts are admin/manager only.
    expect(result.byOperator).toEqual([])
    expect(result.overTime).toEqual([])
    expect(repo.calls.byOperator).toBe(0)
    expect(repo.calls.overTime).toBe(0)
  })

  it('filters KPIs + zoneCount + overTime by operatorId (through the zone)', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({ statsRepository: repo }).getDashboardStats(
      { id: 'a', role: 'ADMIN' },
      { operatorId: 'op1' },
    )
    expect(repo.wheres.count).toEqual({ zone: { operatorId: 'op1' } })
    expect(repo.wheres.homePass).toEqual({ building: { zone: { operatorId: 'op1' } } })
    expect(repo.wheres.zone).toEqual({ operatorId: 'op1' })
    expect(repo.wheres.overTime.operatorId).toBe('op1')
  })

  it('filters KPIs and zone count by cityId (through the operator)', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({ statsRepository: repo }).getDashboardStats(
      { id: 'a', role: 'ADMIN' },
      { cityId: 'c1' },
    )
    expect(repo.wheres.count).toEqual({ zone: { operator: { cityId: 'c1' } } })
    expect(repo.wheres.zone).toEqual({ operator: { cityId: 'c1' } })
    expect(repo.wheres.overTime.cityId).toBe('c1')
  })

  it('combines surveyor scope AND operator filter', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({
      statsRepository: repo,
      userRepository: fakeUserRepo(['z1']),
    }).getDashboardStats({ id: 'u-surv', role: 'SURVEYOR' }, { operatorId: 'op1' })
    expect(repo.wheres.count).toEqual({ ...SURVEYOR_SCOPE, zone: { operatorId: 'op1' } })
  })
})
