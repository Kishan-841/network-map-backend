import { describe, it, expect } from 'vitest'
import { createStatsService } from '../src/modules/stats/stats.service.js'

function fakeStatsRepo() {
  const wheres = {}
  return {
    wheres,
    countBuildings: async (where) => ((wheres.count = where), 5),
    countsByStatus: async (where) => ((wheres.status = where), []),
    sumHomePass: async (where) => ((wheres.homePass = where), 10),
    sumPermissionCost: async (where) => ((wheres.cost = where), 0),
  }
}

describe('dashboard stats scoping', () => {
  it('passes no filter for admins', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({ statsRepository: repo }).getDashboardStats({ id: 'a', role: 'ADMIN' })
    expect(repo.wheres.count).toBeUndefined()
  })

  it('scopes all queries to the surveyor', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({ statsRepository: repo }).getDashboardStats({
      id: 'u-surv',
      role: 'SURVEYOR',
    })
    expect(repo.wheres.count).toEqual({ createdById: 'u-surv' })
    expect(repo.wheres.status).toEqual({ createdById: 'u-surv' })
    expect(repo.wheres.homePass).toEqual({ building: { createdById: 'u-surv' } })
    expect(repo.wheres.cost).toEqual({ building: { createdById: 'u-surv' } })
  })
})
