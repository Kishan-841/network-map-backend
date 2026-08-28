import { describe, it, expect } from 'vitest'
import { createUserSchema } from '../src/modules/users/user.schemas.js'

/**
 * PARTNER_MANAGER recruits and supports external referral partners. It is a
 * staff role, but deliberately has no building, zone or operator access —
 * see partner-network.md §2.1.
 */
describe('PARTNER_MANAGER role', () => {
  it('is assignable when creating a user', () => {
    const parsed = createUserSchema.safeParse({
      name: 'Asha', email: 'a@x.com', password: 'abcd1234', role: 'PARTNER_MANAGER',
    })
    expect(parsed.success).toBe(true)
  })

  it('still rejects a role we do not have', () => {
    const parsed = createUserSchema.safeParse({
      name: 'Asha', email: 'a@x.com', password: 'abcd1234', role: 'WIZARD',
    })
    expect(parsed.success).toBe(false)
  })
})
