import { describe, it, expect } from 'vitest'
import { createStatsService } from '../src/modules/stats/stats.service.js'

// Charts are computed for non-surveyors, so the fake repo needs the chart
// methods too. A MANAGER actor exercises the full (non-surveyor) path.
const manager = { id: 'm', role: 'MANAGER' }

describe('stats service', () => {
  it('assembles dashboard KPIs with zero-defaults for absent statuses', async () => {
    const service = createStatsService({
      statsRepository: {
        countBuildings: async () => 3,
        countsByStatus: async () => [
          { feasibleStatus: 'FEASIBLE', _count: { _all: 2 } },
          { feasibleStatus: 'REJECTED', _count: { _all: 1 } },
        ],
        countsByLive: async () => [
          { isLive: true, _count: { _all: 2 } },
          { isLive: false, _count: { _all: 1 } },
        ],
        sumHomePass: async () => 48,
        sumPermissionCost: async () => '5000.50', // Prisma Decimal serializes to string
        countOperators: async () => 4,
        countZones: async () => 12,
        buildingsByOperator: async () => [
          { operatorId: 'op1', name: 'Op1', buildings: 3, homePass: '48' },
        ],
        buildingsOverTime: async () => [{ date: '2026-08-01', count: 3 }],
      },
    })

    const stats = await service.getDashboardStats(manager)
    expect(stats).toEqual({
      totalBuildings: 3,
      byStatus: { FEASIBLE: 2, PERMISSION_PENDING: 0, REJECTED: 1, SURVEY_PENDING: 0 },
      byLive: { live: 2, notLive: 1 },
      totalHomePass: 48,
      totalPermissionCost: 5000.5,
      operatorCount: 4,
      zoneCount: 12,
      byOperator: [{ operatorId: 'op1', name: 'Op1', buildings: 3, homePass: 48 }],
      overTime: [{ date: '2026-08-01', count: 3 }],
    })
  })

  it('returns zeros for an empty database', async () => {
    const service = createStatsService({
      statsRepository: {
        countBuildings: async () => 0,
        countsByStatus: async () => [],
        countsByLive: async () => [],
        sumHomePass: async () => null,
        sumPermissionCost: async () => null,
        countOperators: async () => 0,
        countZones: async () => 0,
        buildingsByOperator: async () => [],
        buildingsOverTime: async () => [],
      },
    })

    const stats = await service.getDashboardStats(manager)
    expect(stats.totalBuildings).toBe(0)
    expect(stats.totalHomePass).toBe(0)
    expect(stats.totalPermissionCost).toBe(0)
    expect(stats.byStatus.FEASIBLE).toBe(0)
    expect(stats.operatorCount).toBe(0)
    expect(stats.byOperator).toEqual([])
  })
})
