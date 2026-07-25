import { describe, it, expect } from 'vitest'
import { createStatsService } from '../src/modules/stats/stats.service.js'

describe('stats service', () => {
  it('assembles dashboard KPIs with zero-defaults for absent statuses', async () => {
    const service = createStatsService({
      statsRepository: {
        countBuildings: async () => 3,
        countsByStatus: async () => [
          { feasibleStatus: 'FEASIBLE', _count: { _all: 2 } },
          { feasibleStatus: 'REJECTED', _count: { _all: 1 } },
        ],
        sumHomePass: async () => 48,
        sumPermissionCost: async () => '5000.50', // Prisma Decimal serializes to string
      },
    })

    const stats = await service.getDashboardStats()
    expect(stats).toEqual({
      totalBuildings: 3,
      byStatus: {
        FEASIBLE: 2,
        PERMISSION_PENDING: 0,
        REJECTED: 1,
        SURVEY_PENDING: 0,
      },
      totalHomePass: 48,
      totalPermissionCost: 5000.5,
    })
  })

  it('returns zeros for an empty database', async () => {
    const service = createStatsService({
      statsRepository: {
        countBuildings: async () => 0,
        countsByStatus: async () => [],
        sumHomePass: async () => null,
        sumPermissionCost: async () => null,
      },
    })

    const stats = await service.getDashboardStats()
    expect(stats.totalBuildings).toBe(0)
    expect(stats.totalHomePass).toBe(0)
    expect(stats.totalPermissionCost).toBe(0)
    expect(stats.byStatus.FEASIBLE).toBe(0)
  })
})
