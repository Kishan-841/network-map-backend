import { describe, it, expect, vi } from 'vitest'
import { customerRoutes } from '../src/modules/customers/customer.routes.js'
import { customerController } from '../src/modules/customers/customer.controller.js'
import { requireAuth } from '../src/middleware/auth.js'
import { customerRefreshForceThrottle, customerRefreshLimiter } from '../src/middleware/rate-limit.js'

// POST /customers/refresh must run: requireAuth (router-level, so req.user is
// set for the per-user key) → limiter → validateBody → force throttle → handler.
describe('POST /customers/refresh middleware order', () => {
  const stack = customerRoutes.stack
  const refreshIdx = stack.findIndex((l) => l.route?.path === '/refresh' && l.route.methods.post)

  it('requireAuth is a router-level layer before the route', () => {
    expect(refreshIdx).toBeGreaterThan(-1)
    const authIdx = stack.findIndex((l) => !l.route && l.handle === requireAuth)
    expect(authIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(refreshIdx)
  })

  it('limiter → validateBody → force throttle → handler, by identity', () => {
    const handles = stack[refreshIdx].route.stack.map((l) => l.handle)
    expect(handles).toHaveLength(4)
    expect(handles[0]).toBe(customerRefreshLimiter)
    expect(handles[2]).toBe(customerRefreshForceThrottle)
    expect(handles[3]).toBe(customerController.refresh)
  })

  it('the second layer is validateBody for the refresh schema (a fresh closure: checked by behaviour)', () => {
    const validate = stack[refreshIdx].route.stack[1].handle
    const bad = { body: { ids: [] } }
    const nextBad = vi.fn()
    validate(bad, {}, nextBad)
    expect(nextBad).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }))
    const good = { body: { ids: ['a'], force: true, extra: 1 } }
    const nextGood = vi.fn()
    validate(good, {}, nextGood)
    expect(nextGood).toHaveBeenCalledWith()
    expect(good.body).toEqual({ ids: ['a'], force: true }) // parsed body written back
  })
})
