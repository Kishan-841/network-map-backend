/**
 * Pure rules for a building's customers (spec 2026-10-17). No prisma, no HTTP
 * — the same helpers serve the manual form, the sheet import and the tests.
 */

/**
 * An Indian mobile number as digits: the billing sheet writes it with the 91
 * country code, a form may write a +, spaces or dashes. Leading 91 (12 digits)
 * or 0 (11) is dropped, so the same person dedupes to one key.
 */
export function normaliseMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

/**
 * A sheet date → instant. The export writes IST wall-clock as
 * `dd-mm-yyyy HH:MM:SS` (sometimes a bare date); `read-excel-file` may hand
 * back a real Date for a typed cell; our own form posts ISO. Anything else is
 * `null` — the row still imports, with a note in the preview.
 */
export function parseSheetDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const text = String(value ?? '').trim()
  if (!text) return null
  const dmy = text.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  )
  if (dmy) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = dmy
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}+05:30`
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const iso = new Date(text)
  return Number.isNaN(iso.getTime()) ? null : iso
}

/** Letters and digits only, lowercased — so "Phase 1" and "phase1" agree. */
export function foldBuildingName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Resolve requested building names against registry rows (any shape, as long
 * as it has `buildingName`). Exact trimmed/case-insensitive wins; otherwise a
 * punctuation-insensitive fold decides. Never guesses between duplicates: an
 * ambiguous name comes back with every match for the caller to pick from.
 *
 * Returns `{ [requestedName]: { matches: [...rows] } }`.
 */
export function matchBuildingNames(names, buildings) {
  const exact = new Map()
  const folded = new Map()
  for (const building of buildings) {
    const key = String(building?.buildingName ?? '').trim().toLowerCase()
    if (!key) continue
    if (!exact.has(key)) exact.set(key, [])
    exact.get(key).push(building)
    const fold = foldBuildingName(building.buildingName)
    if (!folded.has(fold)) folded.set(fold, [])
    folded.get(fold).push(building)
  }
  const out = {}
  for (const raw of names) {
    const key = String(raw ?? '').trim().toLowerCase()
    const byExact = exact.get(key)
    const matches = byExact?.length ? byExact : (folded.get(foldBuildingName(raw)) ?? [])
    out[raw] = { matches }
  }
  return out
}

/**
 * Why a customer cannot be stored, as plain sentences. Empty array = fine.
 * Mobile is checked after normalisation, so `+91 98674 12726` passes.
 */
export function customerFieldErrors(input) {
  const errors = []
  if (!String(input?.name ?? '').trim()) errors.push('Customer name is missing')
  const mobile = normaliseMobile(input?.mobile)
  if (!mobile) errors.push('Mobile number is missing')
  else if (mobile.length < 10 || mobile.length > 13) errors.push('Mobile number looks wrong')
  const email = String(input?.email ?? '').trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email address looks wrong')
  return errors
}

/**
 * A wing name as a comparable key: lowercase, punctuation dropped, and a
 * leading or trailing *word* "wing" dropped — so `A`, `Wing A`, `A Wing`,
 * `A-wing` and ` wing-a ` all agree. A name with nothing left folds to ''
 * and must never match anything.
 */
export function foldWingName(name) {
  const words = String(name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (words[0] === 'wing') words.shift()
  if (words[words.length - 1] === 'wing') words.pop()
  return words.join('')
}

/**
 * Pick the located wing a sheet's wing cell means. A blank cell is simply "no
 * wing" (no flag). A name matching zero or several wings is never guessed: the
 * customer is added without a wing and the flag says why.
 */
export function matchWing(name, wings) {
  const raw = String(name ?? '').trim()
  if (!raw) return { wingId: null, flag: null }
  const key = foldWingName(raw)
  const hits = key ? (wings ?? []).filter((wing) => foldWingName(wing.name) === key) : []
  if (hits.length === 1) return { wingId: hits[0].id, flag: null }
  const label = `Wing ${raw}`
  return {
    wingId: null,
    flag: hits.length > 1
      ? `${label} matches more than one wing — added without a wing`
      : `${label} is not located yet — added without a wing`,
  }
}

/**
 * Who a customer row is, for re-upload dedupe: the billing username when there
 * is one, otherwise building + normalised mobile.
 */
export function customerIdentity({ username, buildingId, mobile }) {
  const user = String(username ?? '').trim()
  if (user) return `u:${user}`
  return `m:${buildingId}:${normaliseMobile(mobile)}`
}

/** Columns a re-uploaded sheet may update on a stored customer. */
export const MERGE_FIELDS = [
  'username', 'name', 'address', 'mobile', 'email', 'site', 'operator',
  'networkZone', 'planName', 'planAmount', 'planValidityDays', 'autoRenewal',
  'planActivatedAt', 'planExpiresAt', 'status', 'ageingDays', 'wingId',
  'ponNumber', 'olt',
]

const sameValue = (a, b) => {
  const isTime = (v) => v instanceof Date
  if (isTime(a) || isTime(b)) {
    const ta = new Date(a).getTime()
    const tb = new Date(b).getTime()
    return ta === tb
  }
  return a === b
}

/**
 * What a re-upload changes. A blank incoming cell (null / undefined / '') never
 * erases stored data; a filled one is kept only when it differs from what is
 * stored (dates compare by instant). `changed` is false when nothing differs.
 */
export function mergeCustomerUpdate(existing, incoming) {
  const data = {}
  for (const key of MERGE_FIELDS) {
    const next = incoming?.[key]
    if (next === null || next === undefined || next === '') continue
    if (!sameValue(existing?.[key], next)) data[key] = next
  }
  return { data, changed: Object.keys(data).length > 0 }
}
