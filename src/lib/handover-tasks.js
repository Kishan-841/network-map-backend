import { addDays, dateOnly, istToday } from './visit-plan.js'

/**
 * When a building moves to a new holder, the previous holder can no longer
 * check in there, so their planned visit tasks at it would become permanent
 * overdues. These are the tasks to drop: the previous holder's tasks at the
 * building dated today (IST) or later — never a past task, never one of the
 * new holder's, and never today's task at a building the previous holder has
 * already visited today (the same "visited today" rule the import's
 * replaceable() uses).
 *
 * `db` is the Prisma client or a transaction; call it BEFORE the ACTIVE
 * assignments are closed. Returns
 * [{ buildingId, buildingName, fromId, fromName, taskIds }] — one entry per
 * building that has a previous holder other than `newHolderId`.
 */
export async function strandedTasks(db, { buildingIds, newHolderId, now = new Date() }) {
  if (!buildingIds?.length) return []
  const prev = await db.buildingAssignment.findMany({
    where: { buildingId: { in: buildingIds }, status: 'ACTIVE', assignedToId: { not: newHolderId } },
    select: {
      buildingId: true, assignedToId: true,
      building: { select: { buildingName: true } },
      assignedTo: { select: { name: true } },
    },
  })
  if (!prev.length) return []
  const today = istToday(now)
  const pairs = prev.map((p) => ({ assigneeId: p.assignedToId, buildingId: p.buildingId }))
  // Sequential on purpose: `db` may be an interactive transaction (one connection).
  const tasks = await db.visitTask.findMany({
    where: { OR: pairs, taskDate: { gte: dateOnly(today) } },
    select: { id: true, assigneeId: true, buildingId: true, taskDate: true },
  })
  const visits = await db.buildingVisit.findMany({
    where: {
      OR: pairs.map((p) => ({ userId: p.assigneeId, buildingId: p.buildingId })),
      visitedAt: { gte: new Date(`${today}T00:00:00+05:30`), lt: new Date(`${addDays(today, 1)}T00:00:00+05:30`) },
    },
    select: { userId: true, buildingId: true },
  })
  const visitedToday = new Set(visits.map((v) => `${v.userId}|${v.buildingId}`))
  const byPair = new Map()
  for (const t of tasks) {
    const key = `${t.assigneeId}|${t.buildingId}`
    if (t.taskDate.toISOString().slice(0, 10) === today && visitedToday.has(key)) continue
    if (!byPair.has(key)) byPair.set(key, [])
    byPair.get(key).push(t.id)
  }
  return prev.map((p) => ({
    buildingId: p.buildingId, buildingName: p.building.buildingName, fromId: p.assignedToId, fromName: p.assignedTo.name,
    taskIds: byPair.get(`${p.assignedToId}|${p.buildingId}`) ?? [],
  }))
}

/** Delete the stranded tasks (see strandedTasks) inside `tx`; returns how many went. */
export async function releaseStrandedTasks(tx, args) {
  const ids = (await strandedTasks(tx, args)).flatMap((s) => s.taskIds)
  if (!ids.length) return 0
  return (await tx.visitTask.deleteMany({ where: { id: { in: ids } } })).count
}
