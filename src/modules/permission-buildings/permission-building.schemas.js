import { z } from 'zod'
import { PERMISSION_STATUSES, remarkSchema } from '../buildings/building.schemas.js'
import { APPROVAL_STATUSES } from './approval.js'
import { SURVEY_STAGES } from './survey.js'
import {
  MATERIAL_KEYS,
  MAX_MATERIAL_QTY,
  LINK_METHODS,
  MAX_WINGS,
  MAX_LINKS,
} from '../../lib/society-materials.js'

export const listQuerySchema = z.object({
  status: z.enum(PERMISSION_STATUSES).optional(),
  approval: z.enum(APPROVAL_STATUSES).optional(),
  // Phase 3 — where the society stands (survey.js SURVEY_STAGES).
  stage: z.enum(SURVEY_STAGES).optional(),
  // ADMIN only — ignored for a Permission Executive (their scope is themselves).
  createdById: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
})

// The remark is optional here only so the service can answer with a clear
// message ("A remark is required …") instead of the generic validation error.
export const visitSchema = z
  .object({
    remark: remarkSchema.optional(),
    permissionStatus: z.enum(PERMISSION_STATUSES).optional(),
  })
  .strict()

// Phase 2 — an ADMIN's decision. zoneId / reason are optional here only so the
// service answers with the clear message ("Pick a zone", "A reason is required").
export const approveSchema = z
  .object({
    zoneId: z.string().trim().max(100).optional(),
    note: remarkSchema.optional(),
  })
  .strict()

export const rejectSchema = z
  .object({
    reason: remarkSchema.optional(),
  })
  .strict()

// ---- Phase 3: site survey + material request ----

const count = (max) => z.number().int().min(0).max(max)

const checksSchema = z
  .object({
    nameOk: z.boolean().default(false),
    nameCorrection: z.string().trim().max(200).nullish(),
    wingsOk: z.boolean().default(false),
    homePassOk: z.boolean().default(false),
    note: z.string().trim().max(1000).nullish(),
  })
  .strict()

const wingSchema = z
  .object({
    name: z.string().trim().min(1).max(20),
    floors: count(300),
    flatsPerFloor: count(200),
    shafts: count(100),
    homePass: count(100000),
  })
  .strict()

const linkSchema = z
  .object({
    from: z.string().trim().min(1).max(20),
    to: z.string().trim().min(1).max(20),
    method: z.enum(LINK_METHODS),
    meters: z.number().min(0).max(100000).nullish(),
  })
  .strict()

const MATERIAL_KEY_SET = new Set(MATERIAL_KEYS)
const materialsSchema = z
  .record(z.string(), z.number().int().min(0).max(MAX_MATERIAL_QTY))
  .superRefine((materials, ctx) => {
    for (const key of Object.keys(materials)) {
      if (!MATERIAL_KEY_SET.has(key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Unknown material '${key}'` })
      }
    }
  })

/**
 * PUT …/survey. Every part is optional: a part left out keeps its stored value.
 * Links are checked against the wings after that merge (in the service).
 * `remark` is required only for an ADMIN changing an approved survey.
 */
export const surveySchema = z
  .object({
    checks: checksSchema.optional(),
    wings: z
      .array(wingSchema)
      .max(MAX_WINGS)
      .superRefine((wings, ctx) => {
        const seen = new Set()
        wings.forEach((w, i) => {
          const key = w.name.toLowerCase()
          if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: `Wing '${w.name}' is listed twice` })
          seen.add(key)
        })
      })
      .optional(),
    links: z
      .array(linkSchema)
      .max(MAX_LINKS)
      .superRefine((links, ctx) => {
        links.forEach((l, i) => {
          if (l.from.toLowerCase() === l.to.toLowerCase()) {
            ctx.addIssue({ code: 'custom', path: [i, 'to'], message: 'A link must join two different wings' })
          }
        })
      })
      .optional(),
    materials: materialsSchema.optional(),
    remark: remarkSchema.optional(),
  })
  .strict()

/** submit / approve / mark-live — an optional note for the history row. */
// No body at all (Express 5 leaves req.body undefined) is the same as {}.
export const noteSchema = z.preprocess((v) => v ?? {}, z.object({ note: remarkSchema.optional() }).strict())
