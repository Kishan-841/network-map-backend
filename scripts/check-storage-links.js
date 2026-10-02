/**
 * READ-ONLY. Run before making the R2 bucket private.
 *
 *   node scripts/check-storage-links.js
 *
 * For every kind of stored file it counts how many links the API can sign
 * (they start with the current R2_PUBLIC_URL). Any "cannot sign" row would
 * show as a broken image once the bucket is private — fix those first.
 * Old `localhost` links are from before R2 and were never in the bucket.
 * Writes nothing.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const base = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '')
const origin = (u) => {
  try {
    return new URL(u).origin
  } catch {
    return String(u).slice(0, 30)
  }
}

const tally = {}
const add = (kind, url) => {
  if (!url) return
  const verdict = url.startsWith(`${base}/`) ? 'ok (can sign)' : `CANNOT SIGN — ${origin(url)}`
  const key = `${kind} | ${verdict}`
  tally[key] = (tally[key] ?? 0) + 1
}
const images = (row) => (Array.isArray(row.images) ? row.images : []).map((i) => (typeof i === 'string' ? i : i?.url))

for (const r of await prisma.photo.findMany({ select: { url: true } })) add('Building photo', r.url)
for (const r of await prisma.permission.findMany({ select: { documentUrl: true } })) add('Permission letter', r.documentUrl)
for (const r of await prisma.partnerDocument.findMany({ select: { url: true } })) add('Partner document', r.url)
for (const r of await prisma.buildingVisit.findMany({ select: { selfieUrl: true } })) add('Visit selfie', r.selfieUrl)
for (const r of await prisma.teamMeeting.findMany({ select: { photoUrl: true } })) add('Meeting photo', r.photoUrl)
for (const m of ['fiber', 'fiberRoute', 'pop']) {
  for (const r of await prisma[m].findMany({ select: { images: true } })) images(r).forEach((u) => add(`${m} image`, u))
}

console.log(`R2_PUBLIC_URL: ${base || '(not set!)'}`)
console.table(tally)
const bad = Object.entries(tally).filter(([k]) => k.includes('CANNOT') && !k.includes('localhost'))
console.log(
  bad.length
    ? `⚠ ${bad.reduce((n, [, c]) => n + c, 0)} link(s) would break when private`
    : '✓ every R2 file can be signed — safe to make the bucket private',
)
await prisma.$disconnect()
