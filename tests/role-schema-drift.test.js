import { describe, it, expect } from 'vitest'
import { Role } from '@prisma/client'
import { createUserSchema } from '../src/modules/users/user.schemas.js'

/**
 * Every role in the database must be creatable through the API.
 *
 * These drifted once: ACCOUNTS was added to the schema and the UI, but the
 * validation enum was a hand-typed copy that nobody updated, so creating one
 * failed with "expected one of …" and a list missing the new role.
 */
describe('the role list cannot fall behind the schema', () => {
  const base = { name: 'A Person', email: 'a@b.com', password: 'password1' }

  it.each(Object.values(Role))('accepts %s', (role) => {
    const parsed = createUserSchema.safeParse({ ...base, role })
    expect(parsed.success, parsed.error?.issues?.[0]?.message).toBe(true)
  })

  it('still rejects a role that is not in the schema', () => {
    expect(createUserSchema.safeParse({ ...base, role: 'WIZARD' }).success).toBe(false)
  })

  it('covers every role the database defines', () => {
    // If someone adds a role to schema.prisma, this test starts exercising it
    // automatically rather than needing to be remembered.
    expect(Object.values(Role)).toContain('ACCOUNTS')
    expect(Object.values(Role).length).toBeGreaterThanOrEqual(8)
  })
})
