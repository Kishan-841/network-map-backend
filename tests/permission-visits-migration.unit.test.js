import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Roles are mutable: a user who is a PERMISSION_EXECUTIVE today may have
// logged ACQUISITION rows under an earlier role. The move must touch only
// COVERAGE rows, and the backfill must follow exactly the moved set.
const sql = readFileSync(
  new URL('../prisma/migrations/20261008000100_permission_visits/migration.sql', import.meta.url),
  'utf8',
)

describe('migration 20261008000100_permission_visits', () => {
  it('moves only COVERAGE rows created by a Permission Executive', () => {
    expect(sql).toMatch(/u\."role" = 'PERMISSION_EXECUTIVE'\s+AND b\."source" = 'COVERAGE'/)
  })

  it('backfills history from the moved set only (RETURNING → FROM moved)', () => {
    expect(sql).toMatch(/WITH moved AS \(\s*UPDATE "Building"/)
    expect(sql).toMatch(/RETURNING b\."id", b\."createdById", b\."createdAt"/)
    expect(sql).toMatch(/FROM moved m/)
  })
})
