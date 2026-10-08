import { ApiError } from '../../lib/api-error.js'
import { requireRemark } from '../buildings/building.service.js'
import { approvalShape, assertStatusUnlocked } from './approval.js'
import { SOCIETY_MATERIALS, LINK_METHODS, SURVEY_STATUSES } from '../../lib/society-materials.js'
import {
  SURVEY_STAGES,
  maySurvey,
  stageOf,
  surveySummary,
  surveyShape,
  mergeSurvey,
  assertLinksMatchWings,
  assertSubmittable,
} from './survey.js'

/**
 * Society permissions (phase 1) — the Permission Executive's own registry of
 * societies (Building rows with source PERMISSION) and their visit history.
 * A Permission Executive sees only what they added; an ADMIN sees everyone's;
 * out of scope is a 404.
 * Phase 3 (site survey): a SURVEYOR also reads the APPROVED societies in the
 * zones assigned to them, and a MANAGER / SUPERVISOR every APPROVED society —
 * read-only except the survey (surveyor) — see readsSociety.
 */
const READS_APPROVED = ['MANAGER', 'SUPERVISOR']

/** Who may read this society through the module (phase 1–3 rules). */
export function readsSociety(row, actor) {
  if (row?.source !== 'PERMISSION') return false
  switch (actor?.role) {
    case 'ADMIN':
      return true
    case 'PERMISSION_EXECUTIVE':
      return row.createdById === actor.id
    case 'SURVEYOR':
      return row.permissionApproval === 'APPROVED' && !!row.zoneId && (actor.zoneIds ?? []).includes(row.zoneId)
    default:
      return READS_APPROVED.includes(actor?.role) && row.permissionApproval === 'APPROVED'
  }
}

/** The list's role scope — spread LAST so a forged query param cannot widen it. */
function listScope(filters, actor) {
  switch (actor?.role) {
    case 'ADMIN':
      return { createdById: filters.createdById }
    case 'PERMISSION_EXECUTIVE':
      return { createdById: actor.id }
    case 'SURVEYOR':
      return { createdById: undefined, approvedOnly: true, zoneIds: actor.zoneIds ?? [] }
    default:
      if (READS_APPROVED.includes(actor?.role)) return { createdById: undefined, approvedOnly: true }
      throw ApiError.forbidden()
  }
}
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
    if (!readsSociety(row, actor)) throw ApiError.notFound('Society not found')
    return row
  }

  /** In scope, and allowed to write the survey / mark live (else 403). */
  async function loadForSurvey(id, actor, message) {
    const row = await loadInScope(id, actor)
    if (!maySurvey(actor)) throw ApiError.forbidden(message)
    return row
  }

  const approveSocietyFirst = (fresh) => {
    if (fresh?.permissionApproval !== 'APPROVED') throw ApiError.conflict('Approve the society first')
  }

  return {
    async list(filters = {}, actor) {
      const { status, approval, stage, search, page = 1, pageSize = 20 } = filters
      const scope = listScope(filters, actor)
      if (actor?.role === 'PERMISSION_EXECUTIVE' && !scope.createdById) throw ApiError.forbidden()
      const { ids, total } = await repo.pageIds(
        { status, approval, stage, search: search || undefined, ...scope },
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
            isLive: b.isLive,
            survey: surveySummary(b.societySurvey),
            stage: stageOf({ ...b, surveyStatus: b.societySurvey?.status }),
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
      const { permissionVisits, photos, permission, approvalDecidedBy, societySurvey, ...rest } = b
      return {
        ...rest,
        approval: approvalShape(b),
        survey: surveySummary(societySurvey),
        stage: stageOf({ ...b, surveyStatus: societySurvey?.status }),
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

    // ---- Phase 3: site survey + material request ----

    /** The catalogue the survey form offers (mirrored on the web). */
    catalogue() {
      return { materials: SOCIETY_MATERIALS, linkMethods: LINK_METHODS, statuses: SURVEY_STATUSES, stages: SURVEY_STAGES }
    },

    async surveyPendingCount() {
      return { count: await repo.surveyPendingCount() }
    },

    async getSurvey(id, actor) {
      await loadInScope(id, actor)
      return surveyShape(await repo.findSurvey(id))
    },

    /**
     * Create / update the survey. The zone's surveyor edits it until the
     * materials are approved (a REJECTED survey goes back to DRAFT; a change
     * while SUBMITTED is logged); after approval only an ADMIN, with a remark.
     */
    async saveSurvey(id, { remark, ...body }, actor) {
      await loadForSurvey(id, actor, 'Only the zone surveyor or an admin can fill the survey')
      const survey = await repo.withSurveyLock(id, async ({ fresh, write }) => {
        approveSocietyFirst(fresh)
        const current = fresh.societySurvey
        const approved = current?.status === 'APPROVED'
        let note = typeof remark === 'string' && remark.trim() ? remark.trim() : null
        if (approved) {
          if (actor.role !== 'ADMIN') {
            throw ApiError.forbidden('Materials are approved — only an admin can change the survey')
          }
          if (!note) throw ApiError.badRequest('A remark is required — say why the approved survey changes')
        }
        const { next, changes } = mergeSurvey(current, body)
        assertLinksMatchWings(next)
        if (approved && changes.length === 0) throw ApiError.badRequest('Nothing changed')
        const status = !current || current.status === 'REJECTED' ? 'DRAFT' : current.status
        const saved = await write.survey({ ...next, status })
        if (current && ['SUBMITTED', 'APPROVED'].includes(current.status) && changes.length) {
          await write.visit({ userId: actor.id, kind: 'SURVEY_EDITED', remark: note ?? 'Survey edited', changes })
        }
        return saved
      })
      return surveyShape(survey)
    },

    /** DRAFT / REJECTED → SUBMITTED, for the admin to approve the materials. */
    async submitSurvey(id, { note } = {}, actor) {
      await loadForSurvey(id, actor, 'Only the zone surveyor or an admin can submit the survey')
      const survey = await repo.withSurveyLock(id, async ({ fresh, write }) => {
        approveSocietyFirst(fresh)
        const current = fresh.societySurvey
        if (!current) throw ApiError.conflict('Save the survey first')
        if (current.status === 'SUBMITTED') throw ApiError.conflict('Already waiting for approval')
        if (current.status === 'APPROVED') throw ApiError.conflict('Materials are already approved')
        assertSubmittable(current)
        const at = new Date()
        const saved = await write.survey({
          status: 'SUBMITTED',
          submittedAt: at,
          submittedById: actor.id,
          decidedAt: null,
          decidedById: null,
        })
        await write.visit({ userId: actor.id, kind: 'SURVEY_SUBMITTED', remark: note?.trim() || 'Survey submitted', createdAt: at })
        return saved
      })
      return surveyShape(survey)
    },

    /** ADMIN approves the material request (SUBMITTED → APPROVED). */
    async approveMaterials(id, { note } = {}, actor) {
      await loadInScope(id, actor)
      return surveyShape(
        await decideSurvey(id, actor, {
          data: { status: 'APPROVED', rejectReason: null },
          kind: 'MATERIALS_APPROVED',
          remark: note?.trim() || 'Materials approved',
        }),
      )
    },

    /** ADMIN sends the material request back with a reason (SUBMITTED → REJECTED). */
    async rejectMaterials(id, { reason } = {}, actor) {
      await loadInScope(id, actor)
      const text = typeof reason === 'string' ? reason.trim() : ''
      if (!text) throw ApiError.badRequest('A reason is required — tell the surveyor what to fix')
      return surveyShape(
        await decideSurvey(id, actor, {
          data: { status: 'REJECTED', rejectReason: text },
          kind: 'MATERIALS_REJECTED',
          remark: text,
        }),
      )
    },

    /**
     * The zone's surveyor (or an ADMIN) marks an approved-materials society
     * live. The only way a surveyor can ever set isLive.
     */
    async markLive(id, { note } = {}, actor) {
      await loadForSurvey(id, actor, 'Only the zone surveyor or an admin can mark it live')
      await repo.withSurveyLock(id, async ({ fresh, write }) => {
        approveSocietyFirst(fresh)
        if (fresh.societySurvey?.status !== 'APPROVED') throw ApiError.conflict('Materials are not approved yet')
        if (fresh.isLive) throw ApiError.conflict('Already live')
        await write.building({ isLive: true })
        await write.visit({ userId: actor.id, kind: 'MARKED_LIVE', remark: note?.trim() || 'Marked live' })
      })
      return this.get(id, actor)
    },
  }

  function decideSurvey(id, actor, { data, kind, remark }) {
    return repo.withSurveyLock(id, async ({ fresh, write }) => {
      if (fresh?.societySurvey?.status !== 'SUBMITTED') throw ApiError.conflict('Survey is not waiting for approval')
      const at = new Date()
      const saved = await write.survey({ ...data, decidedAt: at, decidedById: actor.id })
      await write.visit({ userId: actor.id, kind, remark, createdAt: at })
      return saved
    })
  }
}
