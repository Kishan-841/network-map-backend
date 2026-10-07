import { poolWhere, scopedUserIds } from '../../lib/sales-visibility.js'

const PLANNERS = ['ADMIN', 'SALES_MANAGER', 'TEAM_LEADER']
const ASSIGNEE_ROLES = ['SALES_EXECUTIVE', 'TEAM_LEADER']

/**
 * Who may plan for whom, and which buildings — the field-sales hierarchy, one
 * step down: admin → anyone; manager → their TLs and every executive under
 * them; team leader → their own executives. An assignee reads only their own.
 */
export function createPlanScope({ repo, salesRepo }) {
  const teamUnder = async (actor) =>
    actor.role === 'SALES_MANAGER' ? salesRepo.idsUnderManager(actor.id)
      : actor.role === 'TEAM_LEADER' ? salesRepo.idsUnderTeamLeader(actor.id)
        : []

  return {
    isPlanner: (role) => PLANNERS.includes(role),
    isAssigneeRole: (role) => ASSIGNEE_ROLES.includes(role),

    async assignees(actor) {
      if (!actor?.id) return []
      const base = { role: { in: ASSIGNEE_ROLES }, isActive: true }
      if (actor.role === 'ADMIN') return repo.listUsersForPlanning(base)
      if (actor.role === 'SALES_MANAGER') return repo.listUsersForPlanning({ ...base, managerId: actor.id })
      if (actor.role === 'TEAM_LEADER') {
        return repo.listUsersForPlanning({ ...base, role: { in: ['SALES_EXECUTIVE'] }, teamLeaderId: actor.id })
      }
      return []
    },

    async readableUserIds(actor) {
      if (!actor?.id) return []
      if (actor.role === 'ADMIN') return null
      if (actor.role === 'SALES_EXECUTIVE') return [actor.id]
      if (actor.role === 'SALES_MANAGER' || actor.role === 'TEAM_LEADER') return [actor.id, ...(await teamUnder(actor))]
      return []
    },

    // `actor` must be req.user (it carries zoneIds); a bare user row would
    // narrow a team leader's pool to what their team holds.
    async assignableBuildingsWhere(actor) {
      if (!actor?.id) return { id: '__none__' }
      if (actor.role === 'ADMIN' || actor.role === 'SALES_MANAGER') return { source: 'COVERAGE' }
      if (actor.role === 'TEAM_LEADER') return poolWhere(actor, scopedUserIds(actor, await teamUnder(actor)))
      return { id: '__none__' }
    },

    /** A TL is never assigned buildings (they work zones), so theirs must already be in their pool. */
    async canWorkBuilding(assignee, building) {
      if (assignee.role !== 'TEAM_LEADER') return true
      const zones = await repo.zoneIdsFor(assignee.id)
      if (building.zoneId && zones.includes(building.zoneId)) return true
      const team = [assignee.id, ...(await salesRepo.idsUnderTeamLeader(assignee.id))]
      const holder = building.salesAssignments?.[0]?.assignedToId
      return Boolean(holder && team.includes(holder))
    },
  }
}
