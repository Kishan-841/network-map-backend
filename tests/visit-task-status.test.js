import { describe, it, expect } from 'vitest'
import { matchDay, taskStatus } from '../src/lib/visit-task-status.js'

const at = (iso) => new Date(iso)
const task = (o) => ({ id: o.id ?? 't', buildingId: 'b', taskDate: '2026-11-03', startTime: null, endTime: null, ...o })
const visit = (o) => ({ id: o.id ?? 'v', buildingId: 'b', visitedAt: at(o.at), checkOutAt: null })

describe('taskStatus', () => {
  const win = task({ startTime: '09:30', endTime: '11:00' })
  it('windowed task', () => {
    expect(taskStatus(win, null, at('2026-11-03T03:00:00Z'))).toBe('UPCOMING')  // 08:30 IST
    expect(taskStatus(win, null, at('2026-11-03T04:30:00Z'))).toBe('DUE_NOW')   // 10:00 IST
    expect(taskStatus(win, null, at('2026-11-03T06:00:00Z'))).toBe('OVERDUE')   // 11:30 IST
    expect(taskStatus(win, visit({ at: '2026-11-03T04:22:00Z' }), at('2026-11-03T06:00:00Z'))).toBe('VISITED') // 09:52
    expect(taskStatus(win, visit({ at: '2026-11-03T08:00:00Z' }), at('2026-11-03T09:00:00Z'))).toBe('VISITED_OUTSIDE')
  })
  it('window edges are inclusive', () => {
    expect(taskStatus(win, null, at('2026-11-03T04:00:00Z'))).toBe('DUE_NOW')   // 09:30 IST
    expect(taskStatus(win, null, at('2026-11-03T05:30:00Z'))).toBe('DUE_NOW')   // 11:00 IST
    expect(taskStatus(win, visit({ at: '2026-11-03T05:30:00Z' }), at('2026-11-03T06:00:00Z'))).toBe('VISITED')
  })
  it('all-day task is overdue only after IST midnight', () => {
    const day = task({})
    expect(taskStatus(day, null, at('2026-11-03T18:29:00Z'))).toBe('DUE_NOW')   // 23:59 IST
    expect(taskStatus(day, null, at('2026-11-03T18:31:00Z'))).toBe('OVERDUE')   // 00:01 next day
    expect(taskStatus(day, null, at('2026-11-02T10:00:00Z'))).toBe('UPCOMING')
  })
  it('a missed task stays missed — status is from its matched visit only', () => {
    expect(taskStatus(task({ taskDate: '2026-11-02' }), null, at('2026-11-03T06:00:00Z'))).toBe('OVERDUE')
  })
})

describe('matchDay', () => {
  it('one visit counts once; the window that contains it wins; the rest is off-plan', () => {
    const tasks = [task({ id: 'am', startTime: '09:00', endTime: '10:00' }), task({ id: 'pm', startTime: '17:00', endTime: '18:00' })]
    const visits = [visit({ id: 'v1', at: '2026-11-03T11:45:00Z' }), { ...visit({ id: 'v2', at: '2026-11-03T05:00:00Z' }), buildingId: 'other' }]
    const out = matchDay({ tasks, visits, now: at('2026-11-03T13:00:00Z') }) // 18:30 IST
    const byId = Object.fromEntries(out.tasks.map((t) => [t.id, t]))
    expect(byId.pm.status).toBe('VISITED')        // 17:15 IST inside the pm window
    expect(byId.pm.visit).toEqual({ id: 'v1', visitedAt: at('2026-11-03T11:45:00Z'), checkOutAt: null })
    expect(byId.am.status).toBe('OVERDUE')
    expect(byId.am.visit).toBeNull()
    expect(out.offPlan.map((v) => v.id)).toEqual(['v2'])
  })

  it('a visit outside every window goes to the earliest unvisited task there', () => {
    const tasks = [task({ id: 'pm', startTime: '17:00', endTime: '18:00' }), task({ id: 'am', startTime: '09:00', endTime: '10:00' })]
    const out = matchDay({ tasks, visits: [visit({ id: 'v1', at: '2026-11-03T08:30:00Z' })], now: at('2026-11-03T13:00:00Z') }) // visit 14:00 IST
    const byId = Object.fromEntries(out.tasks.map((t) => [t.id, t]))
    expect(byId.am.status).toBe('VISITED_OUTSIDE')
    expect(byId.pm.status).toBe('OVERDUE')
    expect(out.offPlan).toEqual([])
  })

  it('two visits, two tasks at one building: each counts once', () => {
    const tasks = [task({ id: 'am', startTime: '09:00', endTime: '10:00' }), task({ id: 'pm', startTime: '17:00', endTime: '18:00' })]
    const visits = [visit({ id: 'v1', at: '2026-11-03T03:45:00Z' }), visit({ id: 'v2', at: '2026-11-03T11:45:00Z' })]
    const out = matchDay({ tasks, visits, now: at('2026-11-03T13:00:00Z') })
    expect(out.tasks.map((t) => [t.id, t.status, t.visit.id])).toEqual([['am', 'VISITED', 'v1'], ['pm', 'VISITED', 'v2']])
  })

  it('a visit at 00:30 IST counts for that IST day (the previous UTC day)', async () => {
    const { istDay } = await import('../src/lib/visit-plan.js')
    const v = visit({ at: '2026-11-02T19:00:00Z' }) // 00:30 IST on 3 Nov
    expect(istDay(v.visitedAt)).toBe('2026-11-03')
    const out = matchDay({ tasks: [task({})], visits: [v], now: at('2026-11-03T06:00:00Z') })
    expect(out.tasks[0].status).toBe('VISITED')
  })
})
