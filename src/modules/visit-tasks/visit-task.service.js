import { ApiError } from '../../lib/api-error.js'
import {
  MAX_UNTIL_DAYS, addDays, expandDates, istDay, istToday, normalizeName, parseSheetDate, parseSheetTime, toMinutes,
} from '../../lib/visit-plan.js'
import { matchDay } from '../../lib/visit-task-status.js'

const MAX_RANGE_DAYS = 62
const OVERDUE_DAYS = 30
const byDayThenStart = (a, b) => a.taskDate.localeCompare(b.taskDate) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99')

const MAX_TASKS = 15000
const pick = (b) => ({ id: b.id, buildingName: b.buildingName, formattedAddress: b.formattedAddress })
const holderOf = (b) => b.salesAssignments?.[0]?.assignedToId ?? null

/** Parse one sheet row's own values (no lookups). */
function parseRow(row, today) {
  const errors = []
  const warnings = []
  const date = parseSheetDate(row.date)
  if (!date) errors.push('Date is missing or not DD-MM-YYYY')
  const s = row.startTime?.trim() ? parseSheetTime(row.startTime) : null
  const e = row.endTime?.trim() ? parseSheetTime(row.endTime) : null
  if (row.startTime?.trim() && !s) errors.push('Start time is not a time')
  if (row.endTime?.trim() && !e) errors.push('End time is not a time')
  if (Boolean(s) !== Boolean(e) && !errors.length) errors.push('Give both a start and an end time, or neither')
  if (s && e && toMinutes(e) <= toMinutes(s)) errors.push('End time must be after start time')
  const repeats = row.weekdays.some(Boolean)
  const until = row.until?.trim() ? parseSheetDate(row.until) : null
  if (row.until?.trim() && !until) errors.push('Repeat until is not a date')
  else if (repeats && !until) errors.push('Weekdays are ticked — add a Repeat until date')
  if (until && date && until < date) errors.push('Repeat until is before Date')
  if (until && until > addDays(today, MAX_UNTIL_DAYS)) errors.push(`Repeat until is more than ${MAX_UNTIL_DAYS} days ahead`)
  let dates = errors.length ? [] : expandDates({ date, until, weekdays: row.weekdays })
  const before = dates.length
  dates = dates.filter((d) => d >= today)
  if (before && !dates.length) warnings.push('Every day in this row has passed — skipped')
  else if (dates.length < before) warnings.push(`${before - dates.length} past day(s) skipped`)
  return { date, until, startTime: s, endTime: e, dates, errors, warnings, skippedPast: before - dates.length }
}

/**
 * Exact name or email auto-matches. A partial ("contains") match is only ever a
 * candidate for the planner to pick — "Amit" sits inside both "Amit Kumar" and
 * "Amit Shah", so it must never be chosen silently.
 */
function matchByName(text, items, nameOf, emailOf = () => null) {
  const n = normalizeName(text)
  if (!n) return { match: null, candidates: [] }
  const raw = String(text ?? '').trim().toLowerCase()
  const exact = items.filter((i) => normalizeName(nameOf(i)) === n || (emailOf(i) && emailOf(i).toLowerCase() === raw))
  if (exact.length === 1) return { match: exact[0], candidates: [] }
  if (exact.length > 1) return { match: null, candidates: exact.slice(0, 5) }
  const loose = items.filter((i) => { const m = normalizeName(nameOf(i)); return m && (m.includes(n) || n.includes(m)) })
  return { match: null, candidates: loose.slice(0, 5) }
}

const overlaps = (a, b) => a.startTime && b.startTime && a.startTime < b.endTime && b.startTime < a.endTime

/** One task's identity — exact duplicates (same person, building, day, window) merge. */
const keyOf = (t, day = t.taskDate) =>
  [t.assigneeId, t.buildingId, day, t.startTime ?? '', t.endTime ?? ''].join('|')
const dayOf = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10))

const CONTESTED = (name) => `${name} is planned for more than one executive — a building has one holder`
const HELD_ELSEWHERE = (name) => `${name} is held by another team`

/**
 * importPlan re-points a building to ONE executive, so within one sheet a
 * building may be planned for one executive only — the current holder's own
 * rows count. Team leaders are never assigned, so their rows don't.
 * `rows` must only hold rows that still have a day left.
 * Returns the set of building ids planned for more than one executive.
 */
function contested(rows) {
  const want = new Map()
  for (const r of rows) {
    if (r.role !== 'SALES_EXECUTIVE') continue
    if (!want.has(r.building.id)) want.set(r.building.id, new Set())
    want.get(r.building.id).add(r.assigneeId)
  }
  return new Set([...want].filter(([, who]) => who.size > 1).map(([id]) => id))
}

/** A team leader may not take a building whose holder is outside their team. */
const heldElsewhere = (mine, who, b) => {
  if (!mine || who.role !== 'SALES_EXECUTIVE') return false
  const h = holderOf(b)
  return Boolean(h && h !== who.id && !mine.includes(h))
}

const byId = (id, items) => {
  const hit = items.find((i) => i.id === id)
  return { match: hit ?? null, candidates: [] }
}

export function createVisitTaskService({ repo, scope }) {
  /**
   * One assignee's existing tasks from today in their range: `del` = no visit
   * (the import replaces them), `keep` = keys of the ones it keeps (visited
   * today), so the import never recreates a task it kept.
   */
  async function replaceable(assigneeId, from, to, today) {
    const start = from < today ? today : from
    if (start > to) return { del: [], keep: new Set() }
    const tasks = await repo.tasksInRange({ assigneeIds: [assigneeId], from: start, to })
    const visits = await repo.visitsInRange({
      userIds: [assigneeId],
      from: new Date(`${today}T00:00:00+05:30`),
      to: new Date(`${addDays(today, 1)}T00:00:00+05:30`),
    })
    const visitedToday = new Set(visits.map((v) => v.buildingId))
    const del = []
    const keep = new Set()
    for (const t of tasks) {
      const day = dayOf(t.taskDate)
      if (day === today && visitedToday.has(t.buildingId)) keep.add(keyOf(t, day))
      else del.push(t)
    }
    return { del, keep }
  }

  function perPerson(rows) {
    const map = new Map()
    for (const r of rows) {
      const p = map.get(r.assigneeId) ?? { assigneeId: r.assigneeId, name: r.name, keys: new Set(), from: null, to: null, buildings: new Set() }
      for (const d of r.dates) {
        p.keys.add(keyOf({ ...r, buildingId: r.building.id }, d))
        if (!p.from || d < p.from) p.from = d
        if (!p.to || d > p.to) p.to = d
      }
      if (r.role === 'SALES_EXECUTIVE' && holderOf(r.building) !== r.assigneeId) p.buildings.add(r.building.id)
      map.set(r.assigneeId, p)
    }
    return [...map.values()]
  }

  /** canWorkBuilding hits the DB for a TL assignee; a sheet repeats the same pairs. */
  function workCheck() {
    const memo = new Map()
    return (who, b) => {
      const key = `${who.id}|${b.id}`
      if (!memo.has(key)) memo.set(key, scope.canWorkBuilding(who, b))
      return memo.get(key)
    }
  }

  /**
   * One person's tasks in [from, to] with live status, plus their visits that
   * matched no task (off-plan). Out of the actor's scope → 404.
   */
  async function listTasks({ userId, from, to } = {}, actor, now = new Date()) {
    const target = userId ?? actor.id
    const readable = await scope.readableUserIds(actor)
    if (readable !== null && !readable.includes(target)) throw ApiError.notFound('Not found')
    const start = from ?? istToday(now)
    const end = to ?? start
    if (end < start || addDays(start, MAX_RANGE_DAYS) < end) {
      throw ApiError.badRequest(`Pick a range of at most ${MAX_RANGE_DAYS} days`)
    }
    // @db.Date comes back as UTC midnight, so its ISO date IS the stored day.
    const tasks = (await repo.tasksInRange({ assigneeIds: [target], from: start, to: end }))
      .map((t) => ({ ...t, taskDate: t.taskDate.toISOString().slice(0, 10) }))
    const visits = await repo.visitsInRange({
      userIds: [target],
      from: new Date(`${start}T00:00:00+05:30`),
      to: new Date(`${addDays(end, 1)}T00:00:00+05:30`),
    })
    const days = new Map()
    const bucket = (d) => {
      if (!days.has(d)) days.set(d, { tasks: [], visits: [] })
      return days.get(d)
    }
    for (const t of tasks) bucket(t.taskDate).tasks.push(t)
    for (const v of visits) bucket(istDay(v.visitedAt)).visits.push(v)
    const out = { tasks: [], offPlan: [] }
    for (const [day, { tasks: dt, visits: dv }] of days) {
      const m = matchDay({ tasks: dt, visits: dv, now })
      out.tasks.push(...m.tasks)
      out.offPlan.push(...m.offPlan.map((v) => ({
        id: v.id, userId: v.userId, buildingId: v.buildingId, buildingName: v.building?.buildingName ?? null,
        visitedAt: v.visitedAt, checkOutAt: v.checkOutAt, day,
      })))
    }
    out.tasks.sort(byDayThenStart)
    out.offPlan.sort((a, b) => a.visitedAt - b.visitedAt)
    return out
  }

  return {
    listTasks,

    /** Missed tasks from the last 30 days, newest first. */
    async listOverdue({ userId } = {}, actor, now = new Date()) {
      const today = istToday(now)
      const { tasks } = await listTasks({ userId, from: addDays(today, -OVERDUE_DAYS), to: today }, actor, now)
      return tasks.filter((t) => t.status === 'OVERDUE').reverse()
    },

    async listAssignees(actor) {
      if (!scope.isPlanner(actor.role)) throw ApiError.forbidden()
      return (await scope.assignees(actor)).map((u) => ({ id: u.id, name: u.name, role: u.role }))
    },

    async searchBuildings(q, actor) {
      if (!scope.isPlanner(actor.role)) throw ApiError.forbidden()
      const text = typeof q === 'string' ? q.trim() : ''
      if (text.length < 2) return []
      return (await repo.searchBuildings(await scope.assignableBuildingsWhere(actor), text, 10)).map(pick)
    },

    async preview({ rows }, actor, now = new Date()) {
      if (!scope.isPlanner(actor.role)) throw ApiError.forbidden()
      const today = istToday(now)
      const people = await scope.assignees(actor)
      const buildings = await repo.listBuildingsLite(await scope.assignableBuildingsWhere(actor))
      const mine = actor.role === 'TEAM_LEADER' ? await scope.readableUserIds(actor) : null
      const canWork = workCheck()
      const out = []
      let ok = []
      let skippedPast = 0
      for (const row of rows) {
        const parsed = parseRow(row, today)
        skippedPast += parsed.skippedPast
        const emp = row.assigneeId ? byId(row.assigneeId, people) : matchByName(row.employee, people, (u) => u.name, (u) => u.email)
        const bld = row.buildingId ? byId(row.buildingId, buildings) : matchByName(row.building, buildings, (b) => b.buildingName)
        const errors = [...parsed.errors]
        if (emp.match && bld.match && !(await canWork(emp.match, bld.match))) {
          errors.push(`${bld.match.buildingName} is not in ${emp.match.name}'s zones or team — give them the zone first`)
        }
        if (emp.match && bld.match && heldElsewhere(mine, emp.match, bld.match)) errors.push(HELD_ELSEWHERE(bld.match.buildingName))
        const state = errors.length ? 'error' : emp.match && bld.match ? 'ok' : 'fix'
        const item = {
          rowNumber: row.rowNumber, state, errors, warnings: parsed.warnings,
          employee: { match: emp.match && { id: emp.match.id, name: emp.match.name }, candidates: emp.candidates.map((u) => ({ id: u.id, name: u.name })) },
          building: { match: bld.match && pick(bld.match), candidates: bld.candidates.map(pick) },
          dates: parsed.dates, startTime: parsed.startTime, endTime: parsed.endTime,
        }
        out.push(item)
        // A row whose every day has passed saves nothing and assigns nothing.
        if (state === 'ok' && parsed.dates.length) {
          ok.push({ ...parsed, assigneeId: emp.match.id, name: emp.match.name, role: emp.match.role, building: bld.match, item })
        }
      }
      // One building, more than one executive — the import would refuse it.
      const clash = contested(ok)
      if (clash.size) {
        ok = ok.filter((r) => {
          if (r.role !== 'SALES_EXECUTIVE' || !clash.has(r.building.id)) return true
          r.item.state = 'error'
          r.item.errors.push(CONTESTED(r.building.buildingName))
          return false
        })
      }
      // Overlapping windows for one person on one day — a warning, not an error.
      const byPerson = new Map()
      for (const r of ok) byPerson.set(r.assigneeId, [...(byPerson.get(r.assigneeId) ?? []), r])
      for (const list of byPerson.values()) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const [a, b] = [list[i], list[j]]
          if (!overlaps(a, b)) continue
          const days = new Set(a.dates)
          if (b.dates.some((d) => days.has(d))) b.item.warnings.push(`Overlaps row ${a.item.rowNumber} for ${b.name}`)
        }
      }
      // Count what the import would create: duplicates merged, kept tasks not recreated.
      const summary = []
      let tasks = 0
      for (const p of perPerson(ok)) {
        const { del, keep } = await replaceable(p.assigneeId, p.from, p.to, today)
        const count = [...p.keys].filter((k) => !keep.has(k)).length
        tasks += count
        summary.push({ assigneeId: p.assigneeId, name: p.name, tasks: count, from: p.from, to: p.to, replaces: del.length, assigns: p.buildings.size })
      }
      const errors = tasks > MAX_TASKS ? [`This sheet makes ${tasks} tasks — the limit is ${MAX_TASKS}`] : []
      return { rows: out, people: summary, totals: { tasks, rows: rows.length, skippedPast }, errors }
    },

    async import({ rows, fileName }, actor, now = new Date()) {
      if (!scope.isPlanner(actor.role)) throw ApiError.forbidden()
      const today = istToday(now)
      const people = new Map((await scope.assignees(actor)).map((u) => [u.id, u]))
      const where = await scope.assignableBuildingsWhere(actor)
      const ids = [...new Set(rows.map((r) => r.buildingId))]
      const buildings = new Map((await repo.listBuildingsLite({ AND: [where, { id: { in: ids } }] })).map((b) => [b.id, b]))
      const mine = actor.role === 'TEAM_LEADER' ? await scope.readableUserIds(actor) : null
      const canWork = workCheck()

      let creates = []
      const seen = new Set()
      const ranges = new Map()
      const checked = []
      for (const r of rows) {
        const who = people.get(r.assigneeId)
        const b = buildings.get(r.buildingId)
        if (!who) throw ApiError.badRequest(`Row ${r.rowNumber}: that person is not on your team`)
        if (!b) throw ApiError.badRequest(`Row ${r.rowNumber}: that building is not one you can plan`)
        if (!(await canWork(who, b))) throw ApiError.badRequest(`Row ${r.rowNumber}: ${b.buildingName} is not in ${who.name}'s zones or team`)
        if (heldElsewhere(mine, who, b)) throw ApiError.badRequest(`Row ${r.rowNumber}: ${HELD_ELSEWHERE(b.buildingName)}`)
        const parsed = parseRow({ ...r, until: r.until ?? '', startTime: r.startTime ?? '', endTime: r.endTime ?? '' }, today)
        if (parsed.errors.length) throw ApiError.badRequest(`Row ${r.rowNumber}: ${parsed.errors[0]}`)
        // Every day passed: the row contributes nothing — no tasks, no assignment.
        if (!parsed.dates.length) continue
        checked.push({ assigneeId: who.id, role: who.role, building: b })
        for (const d of parsed.dates) {
          const task = { assigneeId: r.assigneeId, buildingId: r.buildingId, taskDate: d, startTime: parsed.startTime, endTime: parsed.endTime }
          const key = keyOf(task)
          if (seen.has(key)) continue
          seen.add(key)
          creates.push(task)
          const range = ranges.get(r.assigneeId) ?? { from: d, to: d }
          if (d < range.from) range.from = d
          if (d > range.to) range.to = d
          ranges.set(r.assigneeId, range)
        }
      }
      if (!creates.length) throw ApiError.badRequest('Nothing to save — every day in this sheet has passed')

      // importPlan re-points each building to one holder: the sets must be disjoint.
      const clash = contested(checked)
      if (clash.size) {
        const [id] = clash
        throw ApiError.badRequest(CONTESTED(buildings.get(id).buildingName))
      }
      const toAssign = new Map()
      for (const { assigneeId, role, building } of checked) {
        if (role !== 'SALES_EXECUTIVE' || holderOf(building) === assigneeId) continue
        if (!toAssign.has(assigneeId)) toAssign.set(assigneeId, new Set())
        toAssign.get(assigneeId).add(building.id)
      }

      // Replace unvisited tasks in each range; never recreate one that is kept.
      const deletes = []
      const kept = new Set()
      for (const [assigneeId, { from, to }] of ranges) {
        const { del, keep } = await replaceable(assigneeId, from, to, today)
        deletes.push(...del.map((t) => t.id))
        for (const k of keep) kept.add(k)
      }
      creates = creates.filter((t) => !kept.has(keyOf(t)))
      if (creates.length > MAX_TASKS) throw ApiError.badRequest(`This sheet makes ${creates.length} tasks — the limit is ${MAX_TASKS}`)

      const all = [...ranges.values()]
      return repo.importPlan({
        actorId: actor.id,
        assignments: [...toAssign].map(([assigneeId, set]) => ({ assigneeId, buildingIds: [...set] })),
        deletes,
        creates,
        allowedHolderIds: mine ?? undefined,
        upload: {
          fromDate: all.reduce((m, r) => (r.from < m ? r.from : m), all[0].from),
          toDate: all.reduce((m, r) => (r.to > m ? r.to : m), all[0].to),
          assigneeCount: ranges.size,
          fileName: fileName ?? null,
        },
      })
    },

    async listUploads(actor) {
      if (!scope.isPlanner(actor.role)) throw ApiError.forbidden()
      return repo.listUploads(actor.role === 'ADMIN' ? {} : { uploadedById: actor.id })
    },
  }
}
