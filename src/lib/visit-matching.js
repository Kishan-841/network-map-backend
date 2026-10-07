/**
 * The visits that count for a person's visit-plan tasks (owner decision,
 * 7 Oct 2026): their own check-ins PLUS check-ins where they are listed as a
 * companion (a team leader's visit with the executive along).
 *
 * Every visit returned carries `userId` = the person it counts FOR (so
 * matchDay's per-person grouping works), `byUserId` / `byName` = who really
 * checked in, and `viaCompanion` = true when it is someone else's visit.
 * A companion visit must never be listed as that person's off-plan visit —
 * it isn't theirs to open.
 *
 * This is the ONE definition of "visits that count for this person on these
 * days": task status, the edit lock, the import's keep rule, overdue and the
 * hand-over cleanup all read it. `db` is the Prisma client or a transaction.
 * Sorted by visitedAt.
 */
const visitSelect = {
  id: true, userId: true, buildingId: true, visitedAt: true, checkOutAt: true,
  user: { select: { name: true } },
  building: { select: { id: true, buildingName: true } },
}

const shape = (v, forUserId, viaCompanion) => ({
  id: v.id, userId: forUserId, buildingId: v.buildingId, visitedAt: v.visitedAt, checkOutAt: v.checkOutAt,
  building: v.building, byUserId: v.userId, byName: v.user?.name ?? null, viaCompanion,
})

export async function visitsForMatching(db, { userIds, from, to }) {
  const visitedAt = { gte: from, lt: to }
  const who = userIds ? { userId: { in: userIds } } : {}
  // Sequential on purpose: `db` may be an interactive transaction.
  const own = await db.buildingVisit.findMany({ where: { ...who, visitedAt }, select: visitSelect })
  const along = await db.visitCompanion.findMany({
    where: { ...who, visit: { visitedAt } },
    select: { userId: true, visit: { select: visitSelect } },
  })
  return [
    ...own.map((v) => shape(v, v.userId, false)),
    ...along.filter((c) => c.visit.userId !== c.userId).map((c) => shape(c.visit, c.userId, true)),
  ].sort((a, b) => a.visitedAt - b.visitedAt || a.id.localeCompare(b.id))
}
