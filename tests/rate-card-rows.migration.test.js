import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Production's prices come from the 20261006 migration; dev's came from
 * prisma/seed-rate-card.js. They must be the same 12 rows, or dev and prod pay
 * partners different amounts. Read as text — the seed script writes to the DB
 * when imported.
 */
const rows = (text, pattern) => [...text.matchAll(pattern)].map((m) => `${m[1]}|${m[2]}|${m[3]}`).sort()

describe('rate card rows', () => {
  it('the migration inserts exactly the seed script\'s 12 prices', () => {
    const migration = readFileSync('prisma/migrations/20261006000000_rate_card_rows/migration.sql', 'utf8')
    const seed = readFileSync('prisma/seed-rate-card.js', 'utf8')
    const fromMigration = rows(migration, /\((\d+), '([A-Z_]+)', (\d+)\)/g)
    const fromSeed = rows(seed, /\[(\d+), '([A-Z_]+)', (\d+)\]/g)
    expect(fromMigration).toHaveLength(12)
    expect(fromMigration).toEqual(fromSeed)
  })

  it('never overwrites an existing price', () => {
    const migration = readFileSync('prisma/migrations/20261006000000_rate_card_rows/migration.sql', 'utf8')
    expect(migration).toMatch(/ON CONFLICT \("speedMbps", "billingPeriod", "effectiveFrom"\) DO NOTHING/)
  })
})
