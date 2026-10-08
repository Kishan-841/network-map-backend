import { ApiError } from '../../lib/api-error.js'

/**
 * Society permissions, phase 3 — the site survey + material request rules
 * (pure; the service applies them under the building's row lock).
 * See .superpowers/sdd/2026-10-08-society-survey/design.md.
 *
 *   save    : none → DRAFT, DRAFT → DRAFT, REJECTED → DRAFT, SUBMITTED → SUBMITTED,
 *             APPROVED → APPROVED (ADMIN only, remark required)
 *   submit  : DRAFT | REJECTED → SUBMITTED (≥1 wing, ≥1 material > 0)
 *   decide  : SUBMITTED → APPROVED | REJECTED (ADMIN)
 *   live    : survey APPROVED and building not live → isLive = true
 */
export const SURVEY_PARTS = ['checks', 'wings', 'links', 'materials']

/** The list filter's stages, in the order a society moves through them. */
export const SURVEY_STAGES = ['APPROVAL_PENDING', 'APPROVED_NO_SURVEY', 'SURVEY_SUBMITTED', 'MATERIALS_APPROVED', 'LIVE']

/** Who may write a survey / mark live, once they can read the society at all. */
export const maySurvey = (actor) => actor?.role === 'SURVEYOR' || actor?.role === 'ADMIN'

/**
 * Where a society stands, as one word. Besides the filter's five stages:
 * NOT_SENT (never sent for approval) and APPROVAL_REJECTED.
 */
export function stageOf({ permissionApproval, isLive, surveyStatus }) {
  if (permissionApproval !== 'APPROVED') {
    if (permissionApproval === 'PENDING') return 'APPROVAL_PENDING'
    if (permissionApproval === 'REJECTED') return 'APPROVAL_REJECTED'
    return 'NOT_SENT'
  }
  if (isLive) return 'LIVE'
  if (surveyStatus === 'SUBMITTED') return 'SURVEY_SUBMITTED'
  if (surveyStatus === 'APPROVED') return 'MATERIALS_APPROVED'
  return 'APPROVED_NO_SURVEY'
}

/** The `survey` summary on list items and the detail — null when none was started. */
export const surveySummary = (s) =>
  s ? { status: s.status, submittedAt: s.submittedAt ?? null, decidedAt: s.decidedAt ?? null } : null

const lite = (u) => (u ? { id: u.id, name: u.name } : null)

/** The full survey the API hands out. */
export const surveyShape = (s) =>
  s
    ? {
        id: s.id,
        buildingId: s.buildingId,
        status: s.status,
        checks: s.checks ?? {},
        wings: s.wings ?? [],
        links: s.links ?? [],
        materials: s.materials ?? {},
        rejectReason: s.rejectReason ?? null,
        submittedAt: s.submittedAt ?? null,
        submittedBy: lite(s.submittedBy),
        decidedAt: s.decidedAt ?? null,
        decidedBy: lite(s.decidedBy),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }
    : null

// ---- normalising what is stored, so "changed?" compares like with like ----

const blank = (v) => v === undefined || v === null || v === ''

export function normaliseChecks(checks) {
  const out = {}
  for (const [k, v] of Object.entries(checks ?? {})) if (!blank(v)) out[k] = v
  return out
}

export const normaliseLinks = (links) =>
  (links ?? []).map(({ meters, ...rest }) => (blank(meters) ? rest : { ...rest, meters }))

/** Zero / absent quantity = none: zeros are not stored. */
export function normaliseMaterials(materials) {
  const out = {}
  for (const [k, v] of Object.entries(materials ?? {})) if (v > 0) out[k] = v
  return out
}

/** Key-order-independent JSON (Postgres jsonb reorders object keys). */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/**
 * The survey after this save: parts the body sends replace the stored ones,
 * parts it leaves out are kept. Returns { next, changes } — changes lists the
 * parts that actually differ from the stored survey (every sent part when
 * there is none yet).
 */
export function mergeSurvey(current, body) {
  const next = {
    checks: body.checks !== undefined ? normaliseChecks(body.checks) : current?.checks ?? {},
    wings: body.wings !== undefined ? body.wings : current?.wings ?? [],
    links: body.links !== undefined ? normaliseLinks(body.links) : current?.links ?? [],
    materials: body.materials !== undefined ? normaliseMaterials(body.materials) : current?.materials ?? {},
  }
  const changes = SURVEY_PARTS.filter((part) => canon(next[part]) !== canon(current?.[part] ?? (part === 'wings' || part === 'links' ? [] : {})))
  return { next, changes }
}

/** Every link joins two different wings that exist (names compared case-insensitively). */
export function assertLinksMatchWings({ wings, links }) {
  const names = new Set(wings.map((w) => w.name.trim().toLowerCase()))
  for (const link of links) {
    const from = link.from.trim().toLowerCase()
    const to = link.to.trim().toLowerCase()
    if (!names.has(from) || !names.has(to)) {
      throw ApiError.badRequest(`Link ${link.from} → ${link.to} names a wing that is not in the wings list`)
    }
    if (from === to) throw ApiError.badRequest('A link must join two different wings')
  }
}

/** What a submit needs: at least one wing and one material with a quantity. */
export function assertSubmittable(survey) {
  if (!Array.isArray(survey.wings) || survey.wings.length === 0) {
    throw ApiError.badRequest('Add at least one wing before submitting')
  }
  if (!Object.values(survey.materials ?? {}).some((q) => q > 0)) {
    throw ApiError.badRequest('Request at least one material before submitting')
  }
}
