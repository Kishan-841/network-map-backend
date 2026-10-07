import { ApiError } from '../../lib/api-error.js'
import {
  MAX_UNTIL_DAYS, addDays, expandDates, istDay, istToday, normalizeName, parseSheetDate, parseSheetTime, toMinutes,
} from '../../lib/visit-plan.js'

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

/**
 * importPlan re-points a building to ONE executive, so two executives in one
 * sheet who would both need the same building cannot both be satisfied.
 * Returns Map(buildingId → Set(assigneeId)) for every building wanted by >1.
 */
function contested(rows) {
  const want = new Map()
  for (const r of rows) {
    if (r.role !== 'SALES_EXECUTIVE' || holderOf(r.building) === r.assigneeId) continue
    if (!want.has(r.building.id)) want.set(r.building.id, new Set())
    want.get(r.building.id).add(r.assigneeId)
  }
  return new Map([...want].filter(([, who]) => who.size > 1))
}

export function createVisitTaskService({ repo, scope }) {
  /** Tasks the import would delete for one assignee: from today in their range, no visit. */
  async function replaceable(assigneeId, from, to, today) {
    const start = from < today ? today : from
    if (start > to) return []
    const tasks = await repo.tasksInRange({ assigneeIds: [assigneeId], from: start, to })
    const visits = await repo.visitsInRange({
      userIds: [assigneeId],
      from: new Date(`${today}T00:00:00+05:30`),
      to: new Date(`${addDays(today, 1)}T00:00:00+05:30`),
    })
    const visitedToday = new Set(visits.map((v) => v.buildingId))
    return tasks.filter((t) => !(istDay(t.taskDate) === today && visitedToday.has(t.buildingId)))
  }

  function perPerson(rows) {
    const map = new Map()
    for (const r of rows) {
      const p = map.get(r.assigneeId) ?? { assigneeId: r.assigneeId, name: r.name, tasks: 0, from: null, to: null, buildings: new Set() }
      p.tasks += r.dates.length
      for (const d of r.dates) {
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

  return {
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
      const canWork = workCheck()
      const out = []
      const byRow = new Map()
      let ok = []
      let skippedPast = 0
      for (const row of rows) {
        const parsed = parseRow(row, today)
        skippedPast += parsed.skippedPast
        const emp = matchByName(row.employee, people, (u) => u.name, (u) => u.email)
        const bld = matchByName(row.building, buildings, (b) => b.buildingName)
        const errors = [...parsed.errors]
        if (emp.match && bld.match && !(await canWork(emp.match, bld.match))) {
          errors.push(`${bld.match.buildingName} is not in ${emp.match.name}'s zones or team — give them the zone first`)
        }
        const state = errors.length ? 'error' : emp.match && bld.match ? 'ok' : 'fix'
        const item = {
          rowNumber: row.rowNumber, state, errors, warnings: parsed.warnings,
          employee: { match: emp.match && { id: emp.match.id, name: emp.match.name }, candidates: emp.candidates.map((u) => ({ id: u.id, name: u.name })) },
          building: { match: bld.match && pick(bld.match), candidates: bld.candidates.map(pick) },
          dates: parsed.dates, startTime: parsed.startTime, endTime: parsed.endTime,
        }
        out.push(item)
        byRow.set(row.rowNumber, item)
        if (state === 'ok') ok.push({ ...parsed, assigneeId: emp.match.id, name: emp.match.name, role: emp.match.role, building: bld.match, item })
      }
      // Two executives wanting one building — the import would refuse it.
      const clash = contested(ok)
      if (clash.size) {
        ok = ok.filter((r) => {
          if (!clash.has(r.building.id) || r.role !== 'SALES_EXECUTIVE') return true
          r.item.state = 'error'
          r.item.errors.push(`${r.building.buildingName} is planned for more than one executive in this sheet — a building goes to one executive`)
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
      const summary = []
      for (const p of perPerson(ok)) {
        const replaces = p.from ? (await replaceable(p.assigneeId, p.from, p.to, today)).length : 0
        summary.push({ assigneeId: p.assigneeId, name: p.name, tasks: p.tasks, from: p.from, to: p.to, replaces, assigns: p.buildings.size })
      }
      const tasks = ok.reduce((n, r) => n + r.dates.length, 0)
      return { rows: out, people: summary, totals: { tasks, rows: rows.length, skippedPast } }
    },

    async import({ rows, fileName }, actor, now = new Date()) {
      if (!scope.isPlanner(actor.role)) throw ApiError.forbidden()
      const today = istToday(now)
      const people = new Map((await scope.assignees(actor)).map((u) => [u.id, u]))
      const where = await scope.assignableBuildingsWhere(actor)
      const ids = [...new Set(rows.map((r) => r.buildingId))]
      const buildings = new Map((await repo.listBuildingsLite({ AND: [where, { id: { in: ids } }] })).map((b) => [b.id, b]))
      const canWork = workCheck()

      const creates = []
      const seen = new Set()
      const ranges = new Map()
      const checked = []
      for (const r of rows) {
        const who = people.get(r.assigneeId)
        const b = buildings.get(r.buildingId)
        if (!who) throw ApiError.badRequest(`Row ${r.rowNumber}: that person is not on your team`)
        if (!b) throw ApiError.badRequest(`Row ${r.rowNumber}: that building is not one you can plan`)
        if (!(await canWork(who, b))) throw ApiError.badRequest(`Row ${r.rowNumber}: ${b.buildingName} is not in ${who.name}'s zones or team`)
        const parsed = parseRow({ ...r, until: r.until ?? '', startTime: r.startTime ?? '', endTime: r.endTime ?? '' }, today)
        if (parsed.errors.length) throw ApiError.badRequest(`Row ${r.rowNumber}: ${parsed.errors[0]}`)
        checked.push({ assigneeId: who.id, role: who.role, building: b })
        for (const d of parsed.dates) {
          const key = [r.assigneeId, r.buildingId, d, parsed.startTime, parsed.endTime].join('|')
          if (seen.has(key)) continue
          seen.add(key)
          creates.push({ assigneeId: r.assigneeId, buildingId: r.buildingId, taskDate: d, startTime: parsed.startTime, endTime: parsed.endTime })
          const range = ranges.get(r.assigneeId) ?? { from: d, to: d }
          if (d < range.from) range.from = d
          if (d > range.to) range.to = d
          ranges.set(r.assigneeId, range)
        }
      }
      if (!creates.length) throw ApiError.badRequest('Nothing to save — every day in this sheet has passed')
      if (creates.length > MAX_TASKS) throw ApiError.badRequest(`This sheet makes ${creates.length} tasks — the limit is ${MAX_TASKS}`)

      // importPlan re-points each building to one holder: the sets must be disjoint.
      const clash = contested(checked)
      if (clash.size) {
        const [id] = clash.keys()
        throw ApiError.badRequest(`${buildings.get(id).buildingName} is planned for more than one executive — a building goes to one executive`)
      }
      const toAssign = new Map()
      for (const { assigneeId, role, building } of checked) {
        if (role !== 'SALES_EXECUTIVE' || holderOf(building) === assigneeId) continue
        if (!toAssign.has(assigneeId)) toAssign.set(assigneeId, new Set())
        toAssign.get(assigneeId).add(building.id)
      }
      // A team leader never takes a building another team holds.
      if (actor.role === 'TEAM_LEADER') {
        const mine = await scope.readableUserIds(actor)
        for (const set of toAssign.values()) for (const id of set) {
          const holder = holderOf(buildings.get(id))
          if (holder && !mine.includes(holder)) throw ApiError.badRequest(`${buildings.get(id).buildingName} is held by another team`)
        }
      }

      const deletes = []
      for (const [assigneeId, { from, to }] of ranges) {
        deletes.push(...(await replaceable(assigneeId, from, to, today)).map((t) => t.id))
      }
      const all = [...ranges.values()]
      return repo.importPlan({
        actorId: actor.id,
        assignments: [...toAssign].map(([assigneeId, set]) => ({ assigneeId, buildingIds: [...set] })),
        deletes,
        creates,
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
