/**
 * Pure helpers for the field-sales visit plan (spec 2026-10-07). Every day and
 * time here is Asia/Kolkata: UTC+05:30 all year (India has no DST), so a fixed
 * offset is exact and needs no time-zone library.
 */
const IST_OFFSET_MS = 330 * 60 * 1000
export const MAX_UNTIL_DAYS = 92

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** The IST calendar day of an instant, as 'YYYY-MM-DD'. */
export const istDay = (date) => ymd(new Date(date.getTime() + IST_OFFSET_MS))

/** Minutes since IST midnight for an instant. */
export function istMinutes(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

export const istToday = (now = new Date()) => istDay(now)

/** A 'YYYY-MM-DD' day as the UTC-midnight Date Prisma wants for @db.Date. */
export const dateOnly = (day) => new Date(`${day}T00:00:00.000Z`)

export const addDays = (day, n) => ymd(new Date(dateOnly(day).getTime() + n * 86400000))

/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (day) => (dateOnly(day).getUTCDay() + 6) % 7

function validDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? ymd(dt) : null
}

/** 'YYYY-MM-DD', 'DD-MM-YYYY' or 'DD/MM/YYYY' → 'YYYY-MM-DD'; anything else → null. */
export function parseSheetDate(value) {
  const s = String(value ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return validDay(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) return validDay(+m[3], +m[2], +m[1])
  return null
}

/** 'HH:mm', 'H:mm', 'HH:mm:ss' or 'h:mm AM/PM' → 'HH:mm'; anything else → null. */
export function parseSheetTime(value) {
  const s = String(value ?? '').trim().toLowerCase()
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/)
  if (!m) return null
  let h = +m[1]
  const min = +m[2]
  if (min > 59) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    if (m[3] === 'am') h = h === 12 ? 0 : h
    else h = h === 12 ? 12 : h + 12
  } else if (h > 23) return null
  return `${pad(h)}:${pad(min)}`
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const isYes = (value) => ['y', 'yes', '✓', 'true', '1'].includes(String(value ?? '').trim().toLowerCase())

/** Every day the row asks for: Date alone, or each ticked weekday Date..until. */
export function expandDates({ date, until, weekdays }) {
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  if (typeof date !== 'string' || !ISO.test(date)) return []
  if (!Array.isArray(weekdays) || weekdays.length !== 7) return []
  if (!weekdays.some(Boolean)) return [date]
  if (typeof until !== 'string' || !ISO.test(until) || until < date) return []
  if (until > addDays(date, MAX_UNTIL_DAYS * 2)) return []
  const out = []
  for (let day = date; day <= until; day = addDays(day, 1)) {
    if (weekdays[weekdayIndex(day)]) out.push(day)
  }
  return out
}

/** Lowercase, punctuation to spaces, single spaces — for name matching. */
export const normalizeName = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
