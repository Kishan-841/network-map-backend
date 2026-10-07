import { istDay, istMinutes, toMinutes } from './visit-plan.js'

/**
 * Live status of visit-plan tasks (spec 2026-10-07), computed from check-ins.
 * Every day and minute is IST. `task.taskDate` is 'YYYY-MM-DD'; a task with no
 * startTime is all-day. Window edges are inclusive.
 */
const inWindow = (task, visit) => {
  if (!task.startTime) return true
  const m = istMinutes(visit.visitedAt)
  return m >= toMinutes(task.startTime) && m <= toMinutes(task.endTime)
}

/** Status of one task given its matched visit (or null) at `now`. */
export function taskStatus(task, visit, now) {
  if (visit) return inWindow(task, visit) ? 'VISITED' : 'VISITED_OUTSIDE'
  const today = istDay(now)
  if (task.taskDate > today) return 'UPCOMING'
  if (task.taskDate < today) return 'OVERDUE'
  if (!task.startTime) return 'DUE_NOW'
  const m = istMinutes(now)
  if (m < toMinutes(task.startTime)) return 'UPCOMING'
  return m <= toMinutes(task.endTime) ? 'DUE_NOW' : 'OVERDUE'
}

/** Who checked in rides along when the visit came from lib/visit-matching.js (a TL's visit with the executive as companion). */
const visitOut = (v) => ({
  id: v.id, visitedAt: v.visitedAt, checkOutAt: v.checkOutAt,
  ...('byUserId' in v ? { byUserId: v.byUserId, byName: v.byName, viaCompanion: Boolean(v.viaCompanion) } : {}),
})

const byStart = (a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99')

/**
 * Pair one person's tasks and visits for ONE IST day. A visit counts for at
 * most one task: first every task whose window contains a visit takes the
 * earliest such visit, then any task still open takes the earliest unused visit
 * at its building (earliest task first). Visits left over are off-plan.
 * `visits` should be in visitedAt order (the repository returns them so).
 */
export function matchDay({ tasks, visits, now }) {
  const used = new Set()
  const ordered = [...tasks].sort(byStart)
  const pairs = new Map()
  for (const pass of ['window', 'any']) {
    for (const t of ordered) {
      if (pairs.has(t.id)) continue
      const v = visits.find((x) => !used.has(x.id) && x.buildingId === t.buildingId && (pass === 'any' || inWindow(t, x)))
      if (v) {
        used.add(v.id)
        pairs.set(t.id, v)
      }
    }
  }
  return {
    tasks: tasks.map((t) => {
      const v = pairs.get(t.id) ?? null
      return { ...t, status: taskStatus(t, v, now), visit: v && visitOut(v) }
    }),
    offPlan: visits.filter((v) => !used.has(v.id)),
  }
}
