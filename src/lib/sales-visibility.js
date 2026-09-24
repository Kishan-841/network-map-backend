/**
 * Field-sales visibility (see docs .../2026-09-24-field-sales-design.md §5).
 *
 * `scopedUserIds` maps the actor and the ids of the users beneath them in the
 * hierarchy (resolved by the repository) to the set of user ids whose
 * ACTIVE-held buildings and activity the actor may see:
 *
 *   ADMIN           -> null   (no restriction: every sales row)
 *   SALES_MANAGER   -> self + everyone under them
 *   TEAM_LEADER     -> self + their executives
 *   SALES_EXECUTIVE -> self only
 *   anyone else     -> []     (fails closed: no sales visibility at all)
 *
 * A returned array is spread LAST into the query so a forged id can never widen
 * it, and `{ in: [] }` matches nothing — the same fail-closed shape the rest of
 * the app uses.
 */
export function scopedUserIds(actor, teamUnder = []) {
  if (!actor?.id) return []
  switch (actor.role) {
    case 'ADMIN':
      return null
    case 'SALES_MANAGER':
    case 'TEAM_LEADER':
      return [actor.id, ...teamUnder]
    case 'SALES_EXECUTIVE':
      return [actor.id]
    default:
      return []
  }
}

/** BuildingAssignment.assignedToId predicate for a resolved id set. */
export const assignedToWhere = (ids) => (ids === null ? {} : { assignedToId: { in: ids } })

/** A building is in scope when it has an ACTIVE assignment held by someone in the set. */
export const buildingScopeWhere = (ids) => ({
  salesAssignments: { some: { status: 'ACTIVE', ...assignedToWhere(ids) } },
})

/** May this actor assign / distribute buildings at all? */
export const canAssign = (role) => ['ADMIN', 'SALES_MANAGER', 'TEAM_LEADER'].includes(role)
