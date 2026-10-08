import { ApiError } from '../../lib/api-error.js'
import { requireRemark } from '../buildings/building.service.js'
import { approvalShape, assertStatusUnlocked } from './approval.js'

/**
 * Society permissions (phase 1) — the Permission Executive's own registry of
 * societies (Building rows with source PERMISSION) and their visit history.
 * A Permission Executive sees only what they added; an ADMIN sees everyone's;
 * out of scope is a 404. The route admits no other role.
 */
export const visitShape = (v) => ({
  id: v.id,
  kind: v.kind,
  remark: v.remark,
  statusBefore: v.statusBefore,
  statusAfter: v.statusAfter,
  changes: v.changes ?? [],
  createdAt: v.createdAt,
  user: v.user ? { id: v.user.id, name: v.user.name } : null,
})

const notPending = () => ApiError.conflict('Not waiting for approval')

export function createPermissionBuildingService({ repo, storage, zoneRepository }) {
  const sign = async (url) => (storage?.readUrl && url ? storage.readUrl(url) : url)

  async function loadInScope(id, actor) {
    const row = await repo.findScopeRow(id)
    const visible =
      row?.source === 'PERMISSION' &&
      (actor?.role === 'ADMIN' || (actor?.role === 'PERMISSION_EXECUTIVE' && row.createdById === actor.id))
    if (!visible) throw ApiError.notFound('Society not found')
    return row
  }

  return {
    async list(filters = {}, actor) {
      const { status, approval, search, page = 1, pageSize = 20 } = filters
      // The executive's own scope is spread LAST — a forged createdById cannot widen it.
      const createdById = actor?.role === 'ADMIN' ? filters.createdById : actor?.id
      if (!createdById && actor?.role !== 'ADMIN') throw ApiError.forbidden()
      const { ids, total } = await repo.pageIds(
        { status, approval, search: search || undefined, createdById },
        { skip: (page - 1) * pageSize, take: pageSize },
      )
      const rows = ids.length ? await repo.listRows(ids) : []
      const byId = new Map(rows.map((r) => [r.id, r]))
      const items = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((b) => {
          const last = b.permissionVisits[0]
          return {
            id: b.id,
            buildingName: b.buildingName,
            formattedAddress: b.formattedAddress,
            latitude: b.latitude,
            longitude: b.longitude,
            permissionStatus: b.permission?.permissionStatus ?? null,
            contact: b.contact
              ? {
                  contactName: b.contact.contactName,
                  contactPhone: b.contact.contactPhone,
                  designation: b.contact.designation,
                  designationOther: b.contact.designationOther,
                }
              : null,
            createdBy: b.createdBy,
            createdAt: b.createdAt,
            zone: b.zone ?? null,
            approval: approvalShape(b),
            visitCount: b._count.permissionVisits,
            lastVisit: last
              ? { createdAt: last.createdAt, remark: last.remark, kind: last.kind, user: last.user ?? null }
              : null,
          }
        })
      return {
        items,
        pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      }
    },

    async get(id, actor) {
      await loadInScope(id, actor)
      const b = await repo.findDetail(id)
      if (!b) throw ApiError.notFound('Society not found')
      const { permissionVisits, photos, permission, approvalDecidedBy, ...rest } = b
      return {
        ...rest,
        approval: approvalShape(b),
        permission: permission ? { ...permission, documentUrl: await sign(permission.documentUrl) } : null,
        photos: await Promise.all(photos.map(async (p) => ({ ...p, url: await sign(p.url) }))),
        visits: permissionVisits.map(visitShape),
      }
    },

    async addVisit(id, { remark, permissionStatus }, actor) {
      await loadInScope(id, actor)
      const note = requireRemark(remark)
      const { visit, status } = await repo.recordVisit({
        buildingId: id,
        userId: actor.id,
        remark: note,
        permissionStatus,
        // An approved society keeps its Accepted status (phase 2).
        guard: ({ approval, current }) =>
          assertStatusUnlocked({
            approval,
            current,
            next: permissionStatus,
            isExecutive: actor?.role === 'PERMISSION_EXECUTIVE',
          }),
      })
      return { visit: visitShape(visit), permissionStatus: status }
    },

    /** Societies waiting for an ADMIN — the nav badge. */
    async pendingCount() {
      return { count: await repo.pendingCount() }
    },

    /**
     * ADMIN approves a waiting society into a zone: it becomes a FEASIBLE
     * building in that zone and appears in every staff view (phase 2).
     */
    async approve(id, { zoneId, note }, actor) {
      await loadInScope(id, actor)
      const zone = zoneId ? await zoneRepository.findById(zoneId) : null
      if (!zone) throw ApiError.badRequest('Pick a zone')
      const at = new Date()
      await repo.decide({
        buildingId: id,
        notPending,
        // Under the lock: the zone must not already hold this society (the
        // per-zone Place index would otherwise fail as a bare 409, and a
        // missing / different placeId would slip a duplicate through).
        beforeWrite: async (fresh, tx) => {
          const clash = await repo.findClashInZone(tx, { ...fresh, zoneId: zone.id })
          if (clash) {
            throw ApiError.conflict(`This society is already in ${zone.name} as '${clash.buildingName}'`)
          }
        },
        data: {
          permissionApproval: 'APPROVED',
          approvalReason: null,
          approvalDecidedAt: at,
          approvalDecidedById: actor.id,
          zoneId: zone.id,
          feasibleStatus: 'FEASIBLE',
        },
        visit: { userId: actor.id, kind: 'APPROVED', remark: note?.trim() || 'Approved', createdAt: at },
      })
      return this.get(id, actor)
    },

    /** ADMIN sends a waiting society back with a reason the executive sees. */
    async reject(id, { reason }, actor) {
      await loadInScope(id, actor)
      const text = typeof reason === 'string' ? reason.trim() : ''
      if (!text) throw ApiError.badRequest('A reason is required — tell the executive what to fix')
      const at = new Date()
      await repo.decide({
        buildingId: id,
        notPending,
        data: {
          permissionApproval: 'REJECTED',
          approvalReason: text,
          approvalDecidedAt: at,
          approvalDecidedById: actor.id,
        },
        visit: { userId: actor.id, kind: 'REJECTED', remark: text, createdAt: at },
      })
      return this.get(id, actor)
    },
  }
}
