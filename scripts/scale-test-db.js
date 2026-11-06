/**
 * Build a "tomorrow-sized" copy of the network to measure against.
 *
 * Multiplies buildings, closures, splitters (+ outputs) and fibers (+ points,
 * segments) by --factor inside a SEPARATE database whose name ends in
 * `_scale`. Each copy k gets ids/codes/names suffixed `-x<k>` and is shifted
 * on the map so the copies spread out instead of stacking. Copies drop their
 * OLT link (a PON port can feed only one fiber). POPs, zones and users are
 * shared, not copied.
 *
 * Never touches the dev database: it only ever connects to SCALE_DATABASE_URL
 * and refuses unless that database's name ends in `_scale`.
 *
 *   createdb isp_feasibility_scale
 *   pg_dump --no-owner --no-acl "$DATABASE_URL" | psql -q "postgresql://…/isp_feasibility_scale"
 *   SCALE_DATABASE_URL=postgresql://…/isp_feasibility_scale node scripts/scale-test-db.js --factor 10
 *   # then run the API against it:  DATABASE_URL=$SCALE_DATABASE_URL PORT=4091 OLT_SYNC=off node src/server.js
 */
import { PrismaClient } from '@prisma/client'

const url = process.env.SCALE_DATABASE_URL
const factor = Number(process.argv[process.argv.indexOf('--factor') + 1] ?? 10)

export function scaleDbName(connectionUrl) {
  return new URL(connectionUrl).pathname.replace(/^\//, '')
}

/** The guard, testable: only a `_scale` database, never the dev one. */
export function assertScaleTarget(connectionUrl, devUrl) {
  if (!connectionUrl) throw new Error('Set SCALE_DATABASE_URL to the copy (a database ending in _scale)')
  const name = scaleDbName(connectionUrl)
  if (!name.endsWith('_scale')) throw new Error(`Refusing: database "${name}" does not end in _scale`)
  if (devUrl && scaleDbName(devUrl) === name) throw new Error('Refusing: SCALE_DATABASE_URL points at the dev database')
}

// Per table: which text columns are ids/foreign keys of COPIED rows (suffixed),
// which are unique names (suffixed), which are nulled. Anything else is kept.
export const PLAN = [
  // placeId: unique per zone (hand-written index Building_placeId_zone_key).
  { table: 'Building', ids: ['id'], unique: ['placeId'] },
  { table: 'Closure', ids: ['id', 'buildingId'], unique: ['code'] },
  { table: 'Fiber', ids: ['id'], unique: ['name'], nulls: ['oltId'] },
  { table: 'Splitter', ids: ['id', 'closureId', 'inputFiberId'], unique: ['code'] },
  { table: 'SplitterOutput', ids: ['id', 'splitterId', 'toFiberId', 'toBuildingId'] },
  { table: 'FiberPoint', ids: ['id', 'fiberId', 'closureId', 'splitterId', 'buildingId'] },
  { table: 'FiberSegment', ids: ['id', 'fiberId', 'fromPointId', 'toPointId'] },
]

/** Copy k shifts by whole steps on a 4-wide grid around the original (~13 km a step). */
export function offsetFor(k) {
  const i = k - 1
  return { dLat: (Math.floor(i / 4) + 1) * 0.12 * (i % 2 ? -1 : 1), dLng: ((i % 4) - 1.5) * 0.12 }
}

export function copySql({ table, ids = [], unique = [], nulls = [] }, columns, k) {
  const suffix = `-x${k}`
  const { dLat, dLng } = offsetFor(k)
  const select = columns.map((c) => {
    const col = `"${c}"`
    if (ids.includes(c) || unique.includes(c)) return `CASE WHEN ${col} IS NULL THEN NULL ELSE ${col} || '${suffix}' END`
    if (nulls.includes(c)) return 'NULL'
    if (c === 'latitude') return `${col} + ${dLat}`
    if (c === 'longitude') return `${col} + ${dLng}`
    return col
  })
  const cols = columns.map((c) => `"${c}"`).join(', ')
  // Only originals are copied (copies carry "-x" in their id).
  return `INSERT INTO "${table}" (${cols}) SELECT ${select.join(', ')} FROM "${table}" WHERE "id" NOT LIKE '%-x%'`
}

async function main() {
  assertScaleTarget(url, process.env.DATABASE_URL)
  if (!(factor >= 2 && factor <= 50)) throw new Error('--factor must be 2–50')
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    const already = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Building" WHERE "id" LIKE '%-x%'`)
    if (already[0].n > 0) throw new Error('This database already holds copies — recreate it from a fresh dump first')
    const columnsOf = async (table) =>
      (
        await prisma.$queryRawUnsafe(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          table,
        )
      ).map((r) => r.column_name)
    const columns = Object.fromEntries(await Promise.all(PLAN.map(async (p) => [p.table, await columnsOf(p.table)])))
    for (let k = 2; k <= factor; k++) {
      await prisma.$transaction(PLAN.map((p) => prisma.$executeRawUnsafe(copySql(p, columns[p.table], k))), { timeout: 600000 })
      console.log(`copy ${k}/${factor} done`)
    }
    for (const { table } of PLAN) {
      const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`)
      console.log(`${table.padEnd(15)} ${n}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
