import { ApiError } from '../../lib/api-error.js'
import { salesRepository } from './sales.repository.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { scopedUserIds, canAssign, poolWhere } from '../../lib/sales-visibility.js'

const SALES_ROLES = ['SALES_MANAGER', 'TEAM_LEADER', 'SALES_EXECUTIVE']
// May search the whole building registry and assign any building from it; a
// TEAM_LEADER, by contrast, only distributes their own pool.
const REGISTRY_ASSIGNERS = ['ADMIN', 'SALES_MANAGER']

export function createSalesService({ repo = salesRepository, storage = getStorageProvider() } = {}) {
  // Selfies and meeting photos leave as short-lived signed links (the row keeps
  // the permanent one) — the same rule as building photos and partner
  // documents, so they still show once the bucket is private.
  const sign = async (url) => (url && storage?.readUrl ? storage.readUrl(url) : url)
  const signVisit = async (v) => (v ? { ...v, selfieUrl: await sign(v.selfieUrl) } : v)
  const signMeeting = async (m) => (m ? { ...m, photoUrl: await sign(m.photoUrl) } : m)
  // …and are stored in their permanent form: if a page posts back the signed
  // preview link, saving it would leave a link that stops working in an hour.
  const permanent = (url) => (url && storage?.canonicalUrl ? storage.canonicalUrl(url) : url)
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

    /** The TLs whose zones the actor may set (Team zones page). */
    async listTeamLeaders(actor) {
      if (!REGISTRY_ASSIGNERS.includes(actor.role)) throw ApiError.forbidden()
      return repo.teamLeadersFor(actor)
    },

    /**
     * Replace a team leader's zones. A manager may set only their own TLs; an
     * admin any TL. Anyone else's TL — or a user who is not a TL — is a 404.
     */
    async setTeamLeaderZones(teamLeaderId, { zoneIds }, actor) {
      if (!REGISTRY_ASSIGNERS.includes(actor.role)) throw ApiError.forbidden()
      const target = await repo.findUser(teamLeaderId)
      const mine = actor.role === 'ADMIN' || target?.managerId === actor.id
      if (!target || target.role !== 'TEAM_LEADER' || !mine) throw ApiError.notFound('Team leader not found')
      const ids = [...new Set(zoneIds)]
      if ((await repo.countZones(ids)) !== ids.length) throw ApiError.badRequest('One or more zones do not exist')
      return repo.setUserZones(teamLeaderId, ids)
    },

    /** The actor's in-scope buildings — the SE "my buildings" list / the pool. */
    async listMyBuildings(actor) {
      const ids = await scopeIdsFor(actor)
      if (ids !== null && ids.length === 0) return []
      return repo.listBuildings(poolWhere(actor, ids))
    },

    /**
     * Buildings for the sales MAP, each tagged `assigned` (is it held by someone
     * in the actor's scope, so they may check in there):
     *  - ADMIN / SALES_MANAGER: the WHOLE registry — assigned=true only where the
     *    ACTIVE holder is in their scope (admin: any active holder).
     *  - TEAM_LEADER: their pool — every building in their zones plus what their
     *    team holds; SALES_EXECUTIVE: only what is assigned to them. All
     *    assigned=true.
     * The map click uses `assigned` to choose check-in vs assign.
     */
    async listMapBuildings(actor) {
      const ids = await scopeIdsFor(actor)
      const inScope = (b) =>
        ids === null
          ? (b.salesAssignments?.length ?? 0) > 0
          : (b.salesAssignments ?? []).some((a) => ids.includes(a.assignedToId))
      if (actor.role === 'ADMIN' || actor.role === 'SALES_MANAGER') {
        const buildings = await repo.listAllBuildings()
        return buildings.map((b) => ({ ...b, assigned: inScope(b) }))
      }
      if (ids !== null && ids.length === 0) return []
      const buildings = await repo.listBuildings(poolWhere(actor, ids))
      return buildings.map((b) => ({ ...b, assigned: true }))
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

    /** Search the whole building registry to assign from (a manager / admin). */
    async searchBuildings(q, actor) {
      if (!REGISTRY_ASSIGNERS.includes(actor.role)) throw ApiError.forbidden()
      const query = (q ?? '').trim()
      if (query.length < 2) return []
      return repo.searchBuildings(query)
    },

    /**
     * Assign / distribute buildings to one sales user. The target must be on the
     * actor's team. An ADMIN or SALES_MANAGER may assign any building from the
     * registry; a TEAM_LEADER may only distribute what is already in their pool.
     * Atomic, and it preserves history.
     */
    async assignBuildings({ buildingIds, assignedToId }, actor) {
      if (!canAssign(actor.role)) throw ApiError.forbidden()

      const target = await repo.findUser(assignedToId)
      if (!target || !target.isActive || !SALES_ROLES.includes(target.role)) {
        throw ApiError.badRequest('Assignee must be an active sales user')
      }
      assertTargetInTeam(actor, target)
      // Team leaders work zones now, not hand-picked buildings (spec 2026-10-06).
      if (target.role === 'TEAM_LEADER') {
        throw ApiError.badRequest('Give team leaders zones instead of buildings')
      }

      const ids = [...new Set(buildingIds)]
      if (REGISTRY_ASSIGNERS.includes(actor.role)) {
        if ((await repo.countExisting(ids)) !== ids.length) throw ApiError.badRequest('Some buildings do not exist')
      } else {
        // A team leader distributes only their own pool — their zones plus what
        // their team holds — and never takes a building another team holds,
        // even in a zone two leaders share.
        const scope = await scopeIdsFor(actor)
        const rows = await repo.listBuildings({ AND: [{ id: { in: ids } }, poolWhere(actor, scope)] })
        if (rows.length !== ids.length) {
          throw ApiError.badRequest('Some buildings are not in your pool to assign')
        }
        const taken = rows.find((b) => {
          const holder = b.salesAssignments?.[0]
          return holder && !scope.includes(holder.assignedToId)
        })
        if (taken) {
          throw ApiError.badRequest(`${taken.buildingName} is held by ${taken.salesAssignments[0].assignedTo.name}`)
        }
      }

      await repo.reassign({ buildingIds: ids, assignedToId, assignedById: actor.id })
      return { count: ids.length, assignedToId }
    },

    /** The actor's current open (not yet checked-out) visit, or null. */
    async openVisit(actor) {
      return signVisit(await repo.openVisitFor(actor.id))
    },

    /** Check IN: one open visit at a time; the building must be in scope. */
    async checkIn({ buildingId, checkInLat, checkInLng, selfieUrl, note, companionIds, wentSolo }, actor) {
      if (await repo.openVisitFor(actor.id)) {
        throw ApiError.conflict('Check out of your current building before checking into another')
      }
      const building = await assertBuildingInScope(buildingId, actor)

      // A team leader must record who they went with (their own executives) or
      // that they went solo — one or the other, required.
      let solo = false
      let companions = []
      if (actor.role === 'TEAM_LEADER') {
        const ids = [...new Set(companionIds ?? [])]
        if (wentSolo) {
          solo = true
        } else if (ids.length) {
          const valid = await repo.executivesUnder(actor.id, ids)
          if (valid.length !== ids.length) throw ApiError.badRequest('Pick sales executives from your own team')
          companions = ids
        } else {
          throw ApiError.badRequest('Pick who you went with, or mark that you went solo')
        }
      }

      return signVisit(await repo.createVisit({
        buildingId: building.id,
        userId: actor.id,
        checkInLat,
        checkInLng,
        selfieUrl: permanent(selfieUrl),
        note: note ?? null,
        wentSolo: solo,
        ...(companions.length ? { companions: { create: companions.map((userId) => ({ userId })) } } : {}),
      }))
    },

    /** Mark an activity type done on the actor's own open visit (idempotent). */
    async addActivity(visitId, { type }, actor) {
      const visit = await repo.ownedVisit(visitId, actor.id)
      if (!visit) throw ApiError.notFound('Visit not found')
      if (visit.checkOutAt) throw ApiError.badRequest('This visit is already checked out')
      return repo.addActivity({ visitId, type })
    },

    /** Un-mark an activity type (toggle it off) on the actor's own open visit. */
    async removeActivity(visitId, type, actor) {
      if (!['DESK', 'UMBRELLA', 'LIFT'].includes(type)) throw ApiError.badRequest('Unknown activity')
      const visit = await repo.ownedVisit(visitId, actor.id)
      if (!visit) throw ApiError.notFound('Visit not found')
      if (visit.checkOutAt) throw ApiError.badRequest('This visit is already checked out')
      await repo.removeActivity(visitId, type)
      return { visitId, type, removed: true }
    },

    /** Check OUT: closes the actor's own open visit, capturing the location. */
    async checkOut(visitId, { checkOutLat, checkOutLng }, actor) {
      const visit = await repo.ownedVisit(visitId, actor.id)
      if (!visit) throw ApiError.notFound('Visit not found')
      if (visit.checkOutAt) throw ApiError.badRequest('This visit is already checked out')
      return signVisit(await repo.checkoutVisit(visitId, { checkOutAt: new Date(), checkOutLat, checkOutLng }))
    },

    /**
     * Raise a customer inquiry; the address is snapshotted from the building. If
     * `visitId` is given it must be the actor's OPEN visit at this building.
     */
    async createInquiry({ buildingId, customerName, phone, email, visitId, status, followUpAt }, actor) {
      const building = await assertBuildingInScope(buildingId, actor)
      let linkedVisitId = null
      if (visitId) {
        const visit = await repo.ownedVisit(visitId, actor.id)
        if (!visit || visit.checkOutAt || visit.buildingId !== building.id) {
          throw ApiError.badRequest('Link the inquiry to your open visit at this building')
        }
        linkedVisitId = visitId
      }
      return repo.createInquiry({
        buildingId: building.id,
        createdById: actor.id,
        customerName,
        phone,
        email: email ?? null,
        address: building.formattedAddress,
        visitId: linkedVisitId,
        status: status ?? 'NOT_CONTACTED',
        // The follow-up time only makes sense for a FOLLOW_UP lead.
        followUpAt: status === 'FOLLOW_UP' ? followUpAt : null,
      })
    },

    /**
     * Update a lead's progress after calling the customer. Scoped like the list:
     * the creator, or a team leader / manager above them; out of scope is a 404.
     */
    async updateInquiry(id, { status, followUpAt }, actor) {
      const ids = await scopeIdsFor(actor)
      const found = await repo.findInquiryInScope(id, ids)
      if (!found) throw ApiError.notFound('Lead not found')
      return repo.updateInquiry(id, { status, followUpAt: status === 'FOLLOW_UP' ? followUpAt : null })
    },

    async listVisits(actor, filters = {}) {
      const rows = await repo.listVisits(await activityWhere(actor, filters, 'visitedAt'))
      return Promise.all(rows.map(signVisit))
    },

    /**
     * Log this morning's meeting for the team leader (photo + forced location).
     * One per calendar day, and immutable — a second attempt the same day is a
     * conflict (a TL cannot change a logged meeting's photo or location).
     */
    async createMeeting(actor, { photoUrl, latitude, longitude, note }) {
      const meetingDate = new Date()
      meetingDate.setUTCHours(0, 0, 0, 0) // date-only key
      const existing = await repo.existingMeeting(actor.id, meetingDate)
      if (existing) throw ApiError.conflict("You have already logged today's meeting")
      return signMeeting(
        await repo.createMeeting({
          teamLeaderId: actor.id,
          meetingDate,
          photoUrl: permanent(photoUrl),
          latitude,
          longitude,
          note: note ?? null,
        }),
      )
    },

    /**
     * Meetings a team leader / manager may see (own for a TL, the team's for a
     * manager, all for an admin), filtered by an optional date range and
     * paginated. Returns { items, pagination }.
     */
    async listMeetings(actor, { from, to, page = 1, pageSize = 20 } = {}) {
      const empty = { items: [], pagination: { page: 1, pageSize, total: 0, totalPages: 1 } }
      const ids = await scopeIdsFor(actor)
      if (ids !== null && ids.length === 0) return empty
      const where = {
        ...(ids === null ? {} : { teamLeaderId: { in: ids } }),
        ...(from || to
          ? { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }
          : {}),
      }
      const [total, items] = await Promise.all([
        repo.countMeetings(where),
        repo.listMeetings(where, { skip: (page - 1) * pageSize, take: pageSize }),
      ])
      return {
        items: await Promise.all(items.map(signMeeting)),
        pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      }
    },

    /** One visit in full — scoped, so out of scope is a 404 (the detail page). */
    async getVisit(id, actor) {
      const ids = await scopeIdsFor(actor)
      const visit = await repo.getVisit(id, ids === null ? {} : { userId: { in: ids } })
      if (!visit) throw ApiError.notFound('Visit not found')
      return signVisit(visit)
    },

    async listInquiries(actor, filters = {}) {
      const where = await activityWhere(actor, filters, 'createdAt')
      if (filters.status) where.status = filters.status
      return repo.listInquiries(where)
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

  // A building the actor may act on: it must be in their pool (a TL's zones
  // count). Anything else is a 404, never a hint that it exists.
  async function assertBuildingInScope(buildingId, actor) {
    const ids = await scopeIdsFor(actor)
    if (ids !== null && ids.length === 0) throw ApiError.notFound('Building not found')
    const [building] = await repo.listBuildings({ AND: [{ id: buildingId }, poolWhere(actor, ids)] })
    if (!building) throw ApiError.notFound('Building not found')
    return building
  }
}

export const salesService = createSalesService()
