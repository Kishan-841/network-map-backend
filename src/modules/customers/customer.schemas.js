import { z } from 'zod'

/** '' / null → null, otherwise the trimmed text. */
const nullableText = (max) =>
  z.preprocess((v) => {
    if (v === null || v === undefined) return null
    const text = String(v).trim()
    return text === '' ? null : text
  }, z.string().max(max).nullable())

/**
 * A whole number from a form field, a sheet cell or a JSON number.
 * `z.coerce.number()` would turn '' into 0 (trap), so blank is handled here.
 */
const nullableInt = (max) =>
  z.preprocess((v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
    return v
  }, z.number().int().min(0).max(max).nullable())

/** ISO string (or Date) → Date; blank → null. The sheet's dates arrive pre-parsed. */
const nullableDate = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? null : v),
  z.coerce.date().nullable(),
)

const nullableEmail = z.preprocess((v) => {
  if (v === null || v === undefined) return null
  const text = String(v).trim()
  return text === '' ? null : text
}, z.string().email().max(150).nullable())

const yesNo = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const text = String(v).trim().toUpperCase()
  if (['YES', 'Y', 'TRUE', '1'].includes(text)) return true
  if (['NO', 'N', 'FALSE', '0'].includes(text)) return false
  return v
}, z.boolean().nullable())

/**
 * The customer fields, shared by the create, update and import schemas — one
 * definition, so a column cannot be writable on one route and not another.
 * Every field but `name` and `mobile` is optional: the sheet is the source of
 * truth and a half-filled row is still a customer.
 */
const customerFields = {
  username: nullableText(60),
  name: z.string().trim().min(1).max(120),
  address: nullableText(500),
  mobile: z.string().trim().min(1).max(20),
  email: nullableEmail,
  site: nullableText(100),
  operator: nullableText(100),
  networkZone: nullableText(100),
  planName: nullableText(100),
  planAmount: nullableInt(100_000_000),
  planValidityDays: nullableInt(3650),
  autoRenewal: yesNo,
  planActivatedAt: nullableDate,
  planExpiresAt: nullableDate,
  status: nullableText(40),
  ageingDays: nullableInt(36_500),
  wingId: z.string().min(1).nullable().optional(),
  ponNumber: nullableText(40),
  olt: nullableText(100),
}

export const createCustomerSchema = z.object({
  buildingId: z.string().min(1),
  ...customerFields,
})

/** The building a customer hangs on never changes — a move is delete + add. */
export const updateCustomerSchema = z
  .object(customerFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })

export const listQuerySchema = z.object({
  buildingId: z.string().min(1),
})

/** A query param: '' (an empty select in the URL) means "no filter". */
const blankToUndefined = (schema) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema)
const filterText = blankToUndefined(z.string().trim().max(200).optional())
const filterEnum = (values) => blankToUndefined(z.enum(values).optional())
const pageInt = (max) =>
  blankToUndefined(
    z.preprocess(
      (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v),
      z.number().int().min(1).max(max).optional(),
    ),
  )

/** GET /customers/list and /customers/list.csv — the spec's API section. */
export const listAllQuerySchema = z.object({
  q: filterText,
  zoneId: filterText,
  networkZone: filterText,
  operator: filterText,
  billingStatus: filterText,
  conn: filterEnum(['online', 'offline', 'not_seen', 'not_linked', 'no_username', 'never']),
  weak: filterEnum(['true']),
  expiry: filterEnum(['expired', '7d', '30d']),
  buildingId: filterText,
  planName: filterText,
  autoRenewal: filterEnum(['yes', 'no', 'unset']),
  sort: filterEnum(['name', 'expiry', 'signal', 'checked']).transform((v) => v ?? 'name'),
  page: pageInt(1_000_000).transform((v) => v ?? 1),
  pageSize: pageInt(100).transform((v) => v ?? 50),
})

/** The import preview asks about every distinct building name in the file. */
export const lookupSchema = z.object({
  names: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
})

/**
 * One import row. Deliberately lenient: the browser has already validated the
 * sheet, and the service turns a bad row into a *skip with a reason* rather
 * than failing the whole file with a 400.
 */
const { wingId: _wingId, ...importFields } = customerFields

/**
 * The wing arrives as the sheet's *name* (matched server-side), never an id;
 * the email is plain text so a bad one on an update can be flagged and
 * dropped instead of failing the whole file.
 */
const importRowSchema = z.object({
  row: z.number().int().min(1).max(100_000),
  sheet: nullableText(60),
  buildingId: z.string().min(1).max(100),
  ...importFields,
  name: z.string().trim().max(120),
  mobile: z.string().trim().max(20),
  email: nullableText(150),
  wing: nullableText(60),
})

export const importCustomersSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(1000),
  dryRun: z.boolean().optional(),
})
