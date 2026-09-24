import { ApiError } from '../../lib/api-error.js'
import { salesRepository } from './sales.repository.js'
import { scopedUserIds, buildingScopeWhere, canAssign } from '../../lib/sales-visibility.js'

const SALES_ROLES = ['SALES_MANAGER', 'TEAM_LEADER', 'SALES_EXECUTIVE']

export function createSalesService({ repo = salesRepository } = {}) {
  // The user ids beneath the actor in the hierarchy.
  async function teamUnder(actor) {
    if (actor.role === 'SALES_MANAGER') return repo.idsUnderManager(actor.id)
    if (actor.role === 'TEAM_LEADER') return repo.idsUnderTeamLeader(actor.id)
    return []
  }
  const scopeIdsFor = async (actor) => scopedUserIds(actor, await teamUnder(actor))

  // May the actor hand a building TO this target? The chain only ever flows
  // down one step: admin → anyone, a manager → their own TLs/SEs, a team leader
  // → their own executives.
  function assertTargetInTeam(actor, target) {
    if (actor.role === 'ADMIN') return
    if (actor.role === 'SALES_MANAGER' && target.managerId === actor.id) return
    if (actor.role === 'TEAM_LEADER' && target.role === 'SALES_EXECUTIVE' && target.teamLeaderId === actor.id)
      return
    throw ApiError.forbidden('You can only assign to people on your own team')
  }

  return {
    /** The actor's in-scope buildings — the SE "my buildings" list / the pool. */
    async listMyBuildings(actor) {
      const ids = await scopeIdsFor(actor)
      if (ids !== null && ids.length === 0) return []
      return repo.listBuildings(buildingScopeWhere(ids))
    },

    /** Assignment history for one building the actor can see. */
    async assignmentHistory(buildingId, actor) {
      const ids = await scopeIdsFor(actor)
      const inScope = await repo.assignedInScope([buildingId], ids)
      if (!inScope.has(buildingId)) {
        // An ADMIN may read the history of any existing building; everyone else
        // gets a 404 for one outside their scope (never a 403 that confirms it).
        if (actor.role !== 'ADMIN') throw ApiError.notFound('Building not found')
        if (!(await repo.buildingExists(buildingId))) throw ApiError.notFound('Building not found')
      }
      return repo.history(buildingId)
    },

    /**
     * Assign / distribute buildings to one sales user. The target must be on the
     * actor's team; the buildings must be assignable by the actor (an ADMIN may
     * grant any building from the registry; everyone else only what is already
     * in their pool). Atomic, and it preserves history.
     */
    async assignBuildings({ buildingIds, assignedToId }, actor) {
      if (!canAssign(actor.role)) throw ApiError.forbidden()

      const target = await repo.findUser(assignedToId)
      if (!target || !target.isActive || !SALES_ROLES.includes(target.role)) {
        throw ApiError.badRequest('Assignee must be an active sales user')
      }
      assertTargetInTeam(actor, target)

      const ids = [...new Set(buildingIds)]
      if (actor.role === 'ADMIN') {
        if ((await repo.countExisting(ids)) !== ids.length) throw ApiError.badRequest('Some buildings do not exist')
      } else {
        const pool = await repo.assignedInScope(ids, await scopeIdsFor(actor))
        if (ids.some((id) => !pool.has(id))) {
          throw ApiError.badRequest('Some buildings are not in your pool to assign')
        }
      }

      await repo.reassign({ buildingIds: ids, assignedToId, assignedById: actor.id })
      return { count: ids.length, assignedToId }
    },
  }
}

export const salesService = createSalesService()
