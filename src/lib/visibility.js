/**
 * Who may see a fiber, POP, closure or splitter.
 *
 * The zone is the unit of work: whoever is assigned to a zone sees that
 * zone's cables and sites, so a team shares a patch. On top of that everyone
 * keeps sight of what they added themselves — a manager may save a fiber into
 * a zone that is not on their own list, and it must not vanish as they save
 * it — and an ADMIN sees everything.
 *
 * A closure or splitter carries no zone of its own: it inherits the zone of
 * the fiber it sits on. One that sits on no fiber has no zone to go by, and
 * stays with whoever added it (and ADMINs), as does a fiber or POP recorded
 * before zones were kept.
 *
 * Every helper fails closed: with no actor they match nothing, rather than
 * handing Prisma `{ createdById: undefined }`, which it reads as "no filter".
 */
export const isAdmin = (actor) => actor?.role === 'ADMIN'

const NOTHING = { id: { in: [] } }
const zonesOf = (actor) => actor?.zoneIds ?? []

/** `where` for anything carrying its own `zoneId` — a fiber or a POP. */
export function zoneScope(actor) {
  if (isAdmin(actor)) return {}
  if (!actor?.id) return NOTHING
  const zoneIds = zonesOf(actor)
  const mine = { createdById: actor.id }
  return zoneIds.length ? { OR: [mine, { zoneId: { in: zoneIds } }] } : mine
}

/** `where` for a closure: the zone of any fiber running through it. */
export function closureScope(actor) {
  if (isAdmin(actor)) return {}
  if (!actor?.id) return NOTHING
  const zoneIds = zonesOf(actor)
  const mine = { createdById: actor.id }
  if (!zoneIds.length) return mine
  return { OR: [mine, { points: { some: { fiber: { zoneId: { in: zoneIds } } } } } ] }
}

/**
 * `where` for a splitter. It is reached either as a point on a line of its
 * own, or through the closure it hangs on — so both routes count.
 */
export function splitterScope(actor) {
  if (isAdmin(actor)) return {}
  if (!actor?.id) return NOTHING
  const zoneIds = zonesOf(actor)
  const mine = { createdById: actor.id }
  if (!zoneIds.length) return mine
  const onAFiber = { points: { some: { fiber: { zoneId: { in: zoneIds } } } } }
  return {
    OR: [mine, onAFiber, { closure: { points: { some: { fiber: { zoneId: { in: zoneIds } } } } } }],
  }
}

/**
 * The same rule in JS, for fiber rows already loaded inside another record —
 * the cables at a POP, on an OLT's ports, through a closure, or downstream of
 * a cut. Those rows must carry `createdById` and `zoneId`.
 */
export function canSeeFiber(actor, fiber) {
  if (!fiber) return false
  if (isAdmin(actor)) return true
  if (!actor?.id) return false
  if (fiber.createdById && fiber.createdById === actor.id) return true
  return Boolean(fiber.zoneId) && zonesOf(actor).includes(fiber.zoneId)
}
