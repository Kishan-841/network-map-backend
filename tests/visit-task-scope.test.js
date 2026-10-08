import { describe, it, expect } from 'vitest'
import { COVERAGE_REGISTRY } from '../src/lib/building-source.js'
import { createPlanScope } from '../src/modules/visit-tasks/plan-scope.js'

const users = [
  { id: 'm1', role: 'SALES_MANAGER', isActive: true },
  { id: 't1', role: 'TEAM_LEADER', managerId: 'm1', isActive: true },
  { id: 't2', role: 'TEAM_LEADER', managerId: 'm2', isActive: true },
  { id: 'e1', role: 'SALES_EXECUTIVE', managerId: 'm1', teamLeaderId: 't1', isActive: true },
  { id: 'e2', role: 'SALES_EXECUTIVE', managerId: 'm2', teamLeaderId: 't2', isActive: true },
]
const repo = {
  listUsersForPlanning: async (where) =>
    users.filter((u) =>
      (!where.role?.in || where.role.in.includes(u.role)) &&
      (where.managerId === undefined || u.managerId === where.managerId) &&
      (where.teamLeaderId === undefined || u.teamLeaderId === where.teamLeaderId)),
  zoneIdsFor: async (id) => (id === 't1' ? ['z1'] : []),
  listBuildingsLite: async () => [],
}
const salesRepo = {
  idsUnderManager: async (id) => users.filter((u) => u.managerId === id).map((u) => u.id),
  idsUnderTeamLeader: async (id) => users.filter((u) => u.teamLeaderId === id).map((u) => u.id),
}
const scope = createPlanScope({ repo, salesRepo })

describe('plan scope', () => {
  it('a TL plans only their own executives; a manager their TLs and executives; admin all', async () => {
    expect((await scope.assignees({ id: 't1', role: 'TEAM_LEADER' })).map((u) => u.id)).toEqual(['e1'])
    expect((await scope.assignees({ id: 'm1', role: 'SALES_MANAGER' })).map((u) => u.id).sort()).toEqual(['e1', 't1'])
    expect((await scope.assignees({ id: 'a', role: 'ADMIN' })).map((u) => u.id).sort()).toEqual(['e1', 'e2', 't1', 't2'])
    expect(await scope.assignees({ id: 'e1', role: 'SALES_EXECUTIVE' })).toEqual([])
  })
  it('readers: an assignee reads only themselves; planners their assignees + self', async () => {
    expect(await scope.readableUserIds({ id: 'e1', role: 'SALES_EXECUTIVE' })).toEqual(['e1'])
    expect((await scope.readableUserIds({ id: 't1', role: 'TEAM_LEADER' })).sort()).toEqual(['e1', 't1'])
    expect(await scope.readableUserIds({ id: 'a', role: 'ADMIN' })).toBeNull()
    expect(await scope.readableUserIds({ id: 'x', role: 'SURVEYOR' })).toEqual([])
  })
  it('buildings: manager/admin the coverage registry; a TL their pool', async () => {
    expect(await scope.assignableBuildingsWhere({ id: 'm1', role: 'SALES_MANAGER' })).toEqual(COVERAGE_REGISTRY)
    const tl = await scope.assignableBuildingsWhere({ id: 't1', role: 'TEAM_LEADER', zoneIds: ['z1'] })
    expect(JSON.stringify(tl)).toContain('z1')
  })
  it("a TL assignee may only get buildings in their own pool; an executive any", async () => {
    expect(await scope.canWorkBuilding({ id: 'e1', role: 'SALES_EXECUTIVE' }, { id: 'b', zoneId: 'zz', salesAssignments: [] })).toBe(true)
    expect(await scope.canWorkBuilding({ id: 't1', role: 'TEAM_LEADER' }, { id: 'b', zoneId: 'z1', salesAssignments: [] })).toBe(true)
    expect(await scope.canWorkBuilding({ id: 't1', role: 'TEAM_LEADER' }, { id: 'b', zoneId: 'z9', salesAssignments: [] })).toBe(false)
    expect(await scope.canWorkBuilding({ id: 't1', role: 'TEAM_LEADER' }, { id: 'b', zoneId: 'z9', salesAssignments: [{ assignedToId: 'e1' }] })).toBe(true)
  })
  it('fails closed for an actor with no id, and for roles that plan nothing', async () => {
    expect(await scope.assignees({ role: 'SALES_MANAGER' })).toEqual([])
    expect(await scope.readableUserIds({ role: 'SALES_MANAGER' })).toEqual([])
    expect(await scope.assignableBuildingsWhere({ role: 'ADMIN' })).toEqual({ id: '__none__' })
    expect(await scope.assignableBuildingsWhere({ id: 'e1', role: 'SALES_EXECUTIVE' })).toEqual({ id: '__none__' })
  })
})
