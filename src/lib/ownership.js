/**
 * Who may see a fiber, closure, POP or splitter: the person who made it, and
 * an ADMIN. Nobody else — managers and supervisors included.
 *
 * A row nobody could be traced to (`createdById` null) is the ADMIN's alone.
 * Both helpers fail closed: with no actor they match nothing, rather than
 * handing Prisma `{ createdById: undefined }`, which it reads as "no filter".
 */
export function ownerScope(actor) {
  if (actor?.role === 'ADMIN') return {}
  if (!actor?.id) return { id: { in: [] } }
  return { createdById: actor.id }
}

export function mayOwn(actor, row) {
  if (!row) return false
  if (actor?.role === 'ADMIN') return true
  return Boolean(actor?.id) && row.createdById === actor.id
}
