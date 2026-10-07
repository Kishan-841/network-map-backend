import { describe, it, expect } from 'vitest'
import { createNameMatcher } from '../src/modules/visit-tasks/visit-task.service.js'

/** The preview's name matcher: precomputed once per request, so a big sheet doesn't stall the server. */
describe('createNameMatcher', () => {
  const people = [
    { id: '1', name: 'Amit Kumar', email: 'amit.k@x.in' },
    { id: '2', name: 'Amit Shah', email: 'shah@x.in' },
    { id: '3', name: 'Priya  Patil', email: 'priya@x.in' },
    { id: '4', name: 'priya patil', email: 'pp2@x.in' },
  ]
  const match = createNameMatcher(people, (u) => u.name, (u) => u.email)

  it('an exact name or email auto-matches; case and spacing do not matter', () => {
    expect(match('amit kumar').match.id).toBe('1')
    expect(match('  SHAH@x.in ').match.id).toBe('2')
  })
  it('two exact matches are candidates, in list order', () => {
    expect(match('Priya Patil')).toEqual({ match: null, candidates: [people[2], people[3]] })
  })
  it('a partial name is only ever a candidate', () => {
    expect(match('Amit')).toEqual({ match: null, candidates: [people[0], people[1]] })
  })
  it('blank text matches nothing', () => {
    expect(match('  ')).toEqual({ match: null, candidates: [] })
  })
  it('without an email function, an email-looking text matches no one', () => {
    expect(createNameMatcher(people, (u) => u.name)('shah@x.in')).toEqual({ match: null, candidates: [] })
  })

  it('3,000 rows against 5,000 buildings finish in under 2 s', () => {
    const buildings = Array.from({ length: 5000 }, (_, i) => ({ id: `b${i}`, buildingName: `Building Number ${i} Tower ${i % 37}` }))
    const t0 = performance.now()
    const m = createNameMatcher(buildings, (b) => b.buildingName)
    let hits = 0
    for (let i = 0; i < 3000; i++) {
      const r = m(i % 2 ? `Building Number ${i} Tower ${i % 37}` : `Nowhere ${i} Heights Plaza`)
      if (r.match) hits++
    }
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(hits).toBe(1500)
  })
})
