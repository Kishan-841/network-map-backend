/**
 * Society permissions: a Permission Executive's societies are Building rows
 * with source PERMISSION. Until an ADMIN approves one (phase 2) it stays out of
 * every staff registry view — Buildings, map, stats, sales, visit planning,
 * partner search / matching. Once APPROVED it appears there like any building.
 * Every list / search / count that is not the Permission Executive's own scope
 * or the permission-buildings module goes through these.
 * See .superpowers/sdd/2026-10-08-society-approval/design.md.
 */
export const APPROVED = 'APPROVED'

/** Every building a staff view may show: anything but a not-yet-approved society. */
export const VISIBLE_BUILDING = Object.freeze({
  OR: [{ source: { not: 'PERMISSION' } }, { permissionApproval: APPROVED }],
})

/** An approved society, as a where. */
export const APPROVED_SOCIETY = Object.freeze({ source: 'PERMISSION', permissionApproval: APPROVED })

/** The coverage registry: COVERAGE rows plus approved societies (never ACQUISITION). */
export const COVERAGE_REGISTRY = Object.freeze({ OR: [{ source: 'COVERAGE' }, APPROVED_SOCIETY] })

/** A society not (yet) approved — the rows the staff views hide. */
export const HIDDEN_SOCIETY = Object.freeze({
  source: 'PERMISSION',
  OR: [{ permissionApproval: null }, { permissionApproval: { in: ['PENDING', 'REJECTED'] } }],
})

/** Compose a predicate with an existing where — AND, never spread (an OR may be inside). */
export const andWhere = (where, predicate) =>
  where && Object.keys(where).length ? { AND: [where, predicate] } : { ...predicate }

/** Compose visibility with an existing where. */
export const visibleOnly = (where) => andWhere(where, VISIBLE_BUILDING)

/** Is this row shown in staff views? (same rule as VISIBLE_BUILDING, for rows in memory). */
export const isVisibleBuilding = (b) => b?.source !== 'PERMISSION' || b?.permissionApproval === APPROVED
