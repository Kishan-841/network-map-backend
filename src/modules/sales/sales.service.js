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
    /** The sales users the actor may assign buildings to (the target picker). */
    async listTeam(actor) {
      if (!canAssign(actor.role)) throw ApiError.forbidden()
      return repo.teamMembers(actor)
    },

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

    /** Record a visit to a building the actor holds (or has in their pool). */
    async recordVisit({ buildingId, note }, actor) {
      const building = await assertBuildingInScope(buildingId, actor)
      return repo.recordVisit({ buildingId: building.id, userId: actor.id, note: note ?? null })
    },

    /** Raise a customer inquiry; the address is snapshotted from the building. */
    async createInquiry({ buildingId, customerName, phone, email }, actor) {
      const building = await assertBuildingInScope(buildingId, actor)
      return repo.createInquiry({
        buildingId: building.id,
        createdById: actor.id,
        customerName,
        phone,
        email: email ?? null,
        address: building.formattedAddress,
      })
    },

    async listVisits(actor, filters = {}) {
      return repo.listVisits(await activityWhere(actor, filters, 'visitedAt'))
    },

    async listInquiries(actor, filters = {}) {
      return repo.listInquiries(await activityWhere(actor, filters, 'createdAt'))
    },

    /**
     * Team activity for a manager / team leader (or admin): totals plus a
     * per-person breakdown, all within the actor's scope and the given filters.
     */
    async dashboard(actor, filters = {}) {
      if (!canAssign(actor.role)) throw ApiError.forbidden()
      const [visitWhere, inquiryWhere, team] = await Promise.all([
        activityWhere(actor, filters, 'visitedAt'),
        activityWhere(actor, filters, 'createdAt'),
        repo.teamMembers(actor),
      ])
      const [visits, inquiries, byVisit, byInquiry] = await Promise.all([
        repo.countVisits(visitWhere),
        repo.countInquiries(inquiryWhere),
        repo.visitsByUser(visitWhere),
        repo.inquiriesByUser(inquiryWhere),
      ])
      const vm = new Map(byVisit.map((r) => [r.userId, r._count._all]))
      const im = new Map(byInquiry.map((r) => [r.createdById, r._count._all]))
      const perUser = team.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        visits: vm.get(u.id) ?? 0,
        inquiries: im.get(u.id) ?? 0,
      }))
      return { totals: { visits, inquiries }, team: perUser }
    },
  }

  // The scoped `where` for a visit / inquiry query: the actor's team id set
  // (fail-closed), optionally narrowed to one user (only if they are in scope),
  // plus optional building and date-range filters. `dateField` is `visitedAt`
  // for visits or `createdAt` for inquiries; the id field follows from it.
  async function activityWhere(actor, { userId, buildingId, from, to } = {}, dateField) {
    const scopeIds = await scopeIdsFor(actor)
    let ids = scopeIds
    if (userId) {
      if (scopeIds === null) ids = [userId]
      else ids = scopeIds.includes(userId) ? [userId] : ['__none__']
    }
    const idField = dateField === 'visitedAt' ? 'userId' : 'createdById'
    const range = {}
    if (from) range.gte = from
    if (to) range.lte = to
    return {
      ...(ids === null ? {} : { [idField]: { in: ids } }),
      ...(buildingId ? { buildingId } : {}),
      ...(Object.keys(range).length ? { [dateField]: range } : {}),
    }
  }

  // A building the actor may act on: it must be in their sales scope. Anything
  // else is a 404, never a hint that it exists.
  async function assertBuildingInScope(buildingId, actor) {
    const ids = await scopeIdsFor(actor)
    const inScope = await repo.assignedInScope([buildingId], ids)
    if (!inScope.has(buildingId)) throw ApiError.notFound('Building not found')
    const building = await repo.buildingBasic(buildingId)
    if (!building) throw ApiError.notFound('Building not found')
    return building
  }
}

export const salesService = createSalesService()
