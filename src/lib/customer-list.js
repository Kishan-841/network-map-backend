/**
 * Pure rules for the all-customers list (spec 2026-10-21, decisions 4–7): the
 * filter → Prisma `where`, the sort → `orderBy`, and the CSV export. No prisma
 * client, no HTTP — the service feeds these the scoped building ids.
 */
import { normaliseMobile } from './customers.js'
import { istDay } from './visit-plan.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const CSV_CAP = 5000

/**
 * Plan expiry windows are ROLLING from `now` (the web app uses the same rule):
 * expired = before now; 7d / 30d = from now to now + 7 / 30 × 24 h.
 */
export function expiryWhere(window, now = new Date()) {
  if (window === 'expired') return { planExpiresAt: { lt: now } }
  const days = window === '7d' ? 7 : window === '30d' ? 30 : null
  if (!days) return null
  return { planExpiresAt: { gte: now, lte: new Date(now.getTime() + days * DAY_MS) } }
}

/**
 * The digits to look for in a mobile number — only when the search looks like
 * a phone fragment (digits, spaces, + ( ) -, at least 3 digits). Otherwise
 * "user5" would match every mobile holding a 5.
 */
export function mobileFragment(q) {
  if (!/^[\d\s+()-]+$/.test(q)) return null
  const digits = normaliseMobile(q)
  return digits && digits.length >= 3 ? digits : null
}

/**
 * The customer filter as one AND list. `buildingIds` is the caller's scope,
 * already narrowed by `zoneId` / `buildingId` — this function never widens it.
 */
export function customerListWhere(query, buildingIds, now = new Date()) {
  const and = [{ buildingId: { in: buildingIds } }]
  const q = query.q?.trim()
  if (q) {
    const or = [
      { name: { contains: q, mode: 'insensitive' } },
      { username: { contains: q, mode: 'insensitive' } },
    ]
    const digits = mobileFragment(q)
    if (digits) or.push({ mobile: { contains: digits } })
    and.push({ OR: or })
  }
  if (query.networkZone) and.push({ networkZone: query.networkZone })
  if (query.operator) and.push({ operator: query.operator })
  if (query.billingStatus) and.push({ status: query.billingStatus })
  if (query.planName) and.push({ planName: query.planName })
  if (query.conn === 'never') and.push({ connCheckedAt: null })
  else if (query.conn) and.push({ connState: query.conn })
  if (query.weak === 'true') and.push({ connWeak: true })
  if (query.expiry) and.push(expiryWhere(query.expiry, now))
  if (query.autoRenewal === 'yes') and.push({ autoRenewal: true })
  else if (query.autoRenewal === 'no') and.push({ autoRenewal: false })
  else if (query.autoRenewal === 'unset') and.push({ autoRenewal: null })
  return { AND: and }
}

/** Stable sorts: the id breaks every tie, so pages never repeat or skip a row. */
export function customerListOrderBy(sort) {
  const id = { id: 'asc' }
  switch (sort) {
    case 'expiry':
      return [{ planExpiresAt: { sort: 'asc', nulls: 'last' } }, id]
    case 'signal': // weakest (most negative) first
      return [{ connRxDbm: { sort: 'asc', nulls: 'last' } }, id]
    case 'checked':
      return [{ connCheckedAt: { sort: 'desc', nulls: 'last' } }, id]
    default:
      return [{ name: 'asc' }, id]
  }
}

/** The list row — what the screen and the export may show. Never serial/IP. */
export function toListRow(c) {
  return {
    id: c.id,
    name: c.name,
    username: c.username,
    mobile: c.mobile,
    email: c.email,
    operator: c.operator,
    networkZone: c.networkZone,
    planName: c.planName,
    planAmount: c.planAmount,
    planExpiresAt: c.planExpiresAt,
    status: c.status,
    autoRenewal: c.autoRenewal,
    ponNumber: c.ponNumber,
    olt: c.olt,
    building: { id: c.building.id, buildingName: c.building.buildingName },
    wing: c.wing ? { id: c.wing.id, name: c.wing.name } : null,
    zone: c.building.zone ? { id: c.building.zone.id, name: c.building.zone.name } : null,
    connState: c.connState,
    connRxDbm: c.connRxDbm,
    connRxQuality: c.connRxQuality,
    connOlt: c.connOlt,
    connPon: c.connPon,
    connOnu: c.connOnu,
    connLastSeen: c.connLastSeen,
    connWeak: c.connWeak,
    connCheckedAt: c.connCheckedAt,
  }
}

const CONN_WORDS = {
  online: 'Online',
  offline: 'Offline',
  not_seen: 'Not seen',
  not_linked: 'Not linked',
  no_username: 'No username',
}

const IST_OFFSET_MS = 330 * 60 * 1000
const pad = (n) => String(n).padStart(2, '0')
/** 'YYYY-MM-DD HH:MM' in IST. */
const istDateTime = (date) => {
  const d = new Date(date.getTime() + IST_OFFSET_MS)
  return `${istDay(date)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/**
 * One CSV cell. Text starting with = + - @ (or a tab/CR) is prefixed with a
 * single quote so a spreadsheet never runs it as a formula; numbers are written
 * as numbers (a signal of -18 is not a formula). Quotes, commas and newlines
 * wrap the cell in quotes with inner quotes doubled.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const CSV_COLUMNS = [
  ['Name', (r) => r.name],
  ['Username', (r) => r.username],
  ['Mobile', (r) => r.mobile],
  ['Email', (r) => r.email],
  ['Building', (r) => r.building.buildingName],
  ['Wing', (r) => r.wing?.name],
  ['Zone', (r) => r.zone?.name],
  ['Network zone', (r) => r.networkZone],
  ['Operator', (r) => r.operator],
  ['Plan', (r) => r.planName],
  ['Amount', (r) => r.planAmount],
  ['Expires', (r) => (r.planExpiresAt ? istDay(new Date(r.planExpiresAt)) : null)],
  ['Billing status', (r) => r.status],
  ['Auto renewal', (r) => (r.autoRenewal == null ? null : r.autoRenewal ? 'Yes' : 'No')],
  ['PON', (r) => r.ponNumber],
  ['OLT', (r) => r.olt],
  ['Connection', (r) => (r.connCheckedAt ? (CONN_WORDS[r.connState] ?? r.connState) : 'Not checked')],
  ['Signal (dBm)', (r) => r.connRxDbm],
  ['Signal quality', (r) => r.connRxQuality],
  ['Last seen', (r) => (r.connLastSeen ? istDateTime(new Date(r.connLastSeen)) : null)],
  ['Checked at', (r) => (r.connCheckedAt ? istDateTime(new Date(r.connCheckedAt)) : null)],
]

/** List rows → the export file's text: UTF-8 BOM (Excel), CRLF lines. */
export function customersCsv(rows) {
  const lines = [CSV_COLUMNS.map(([title]) => csvCell(title)).join(',')]
  for (const row of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(row))).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

export const csvFilename = (now = new Date()) => `customers-${istDay(now)}.csv`
