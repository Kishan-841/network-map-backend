import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { FIBER_INCLUDE, FIBER_LIST_INCLUDE, fiberRepository } from '../src/modules/fibers/fiber.repository.js'
import { listFiber, shapeFiber } from '../src/modules/fibers/fiber.service.js'

// GET /fibers (the map, the Fibers tab, the editor) used to load each fiber
// with its OLT, feed, creator and full segments — all thrown away by
// listFiber. The list query now asks only for what the list sends; the
// response must not change by a single field.
afterAll(() => prisma.$disconnect())

describe('slim /fibers list query', () => {
  it('does not load what listFiber throws away', () => {
    expect(FIBER_LIST_INCLUDE).not.toHaveProperty('olt')
    expect(FIBER_LIST_INCLUDE).not.toHaveProperty('fedBy')
    expect(FIBER_LIST_INCLUDE).not.toHaveProperty('createdBy')
    expect(FIBER_LIST_INCLUDE.segments.select).toBeDefined()
  })

  it('produces exactly the same list rows as the full include', async () => {
    const where = {}
    const full = await prisma.fiber.findMany({ where, orderBy: { name: 'asc' }, include: FIBER_INCLUDE, take: 300 })
    const slim = await prisma.fiber.findMany({ where, orderBy: { name: 'asc' }, include: FIBER_LIST_INCLUDE, take: 300 })
    expect(slim.length).toBe(full.length)
    expect(slim.map((f) => listFiber(shapeFiber(f)))).toEqual(full.map((f) => listFiber(shapeFiber(f))))
  })

  it('the repository list uses the slim include', async () => {
    const rows = await fiberRepository.list({ id: '__none__' })
    expect(rows).toEqual([])
    const src = fiberRepository.list.toString()
    expect(src).toContain('FIBER_LIST_INCLUDE')
  })
})
