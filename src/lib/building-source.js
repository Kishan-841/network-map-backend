/**
 * Society permissions (phase 1): a Permission Executive's societies are
 * Building rows with source PERMISSION, and they stay out of every staff
 * registry view — Buildings, map, stats, sales, visit planning — until a later
 * phase moves them into coverage. Every list / search / count that is not the
 * Permission Executive's own scope or the permission-buildings module adds
 * this. See .superpowers/sdd/2026-10-08-society-permissions/design.md.
 */
export const NOT_PERMISSION = Object.freeze({ source: { not: 'PERMISSION' } })

/** Compose the exclusion with an existing where (AND — never spread, an OR may be inside). */
export const withoutPermission = (where) =>
  where && Object.keys(where).length ? { AND: [where, NOT_PERMISSION] } : { ...NOT_PERMISSION }
