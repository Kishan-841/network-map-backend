import { ApiError } from '../../lib/api-error.js'
import { requireRemark } from '../buildings/building.service.js'

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

export function createPermissionBuildingService({ repo, storage }) {
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
      const { status, search, page = 1, pageSize = 20 } = filters
      // The executive's own scope is spread LAST — a forged createdById cannot widen it.
      const createdById = actor?.role === 'ADMIN' ? filters.createdById : actor?.id
      if (!createdById && actor?.role !== 'ADMIN') throw ApiError.forbidden()
      const { ids, total } = await repo.pageIds(
        { status, search: search || undefined, createdById },
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
      const { permissionVisits, photos, permission, ...rest } = b
      return {
        ...rest,
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
      })
      return { visit: visitShape(visit), permissionStatus: status }
    },
  }
}
