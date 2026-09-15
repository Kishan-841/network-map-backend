import { z } from 'zod'

export const CORE_COUNTS = [2, 4, 6, 12, 24, 48]

// Numbers arrive from HTML forms as strings; a blank field means "not supplied",
// not "zero". z.coerce would turn '' into 0, so preprocess to undefined instead.
const num = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema)

const pointSchema = z
  .object({
    type: z.enum(['WAYPOINT', 'POP', 'CLOSURE', 'BUILDING']).default('WAYPOINT'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    popId: z.string().nullish(),
    closureId: z.string().nullish(),
    buildingId: z.string().nullish(),
    newClosure: z.object({ kind: z.string().trim().max(50).nullish() }).nullish(),
    newPop: z.object({ name: z.string().trim().min(1).max(100) }).nullish(),
  })
  .superRefine((p, ctx) => {
    const has = {
      POP: p.popId || p.newPop,
      CLOSURE: p.closureId || p.newClosure,
      BUILDING: p.buildingId,
    }
    if (p.type !== 'WAYPOINT' && !has[p.type]) {
      ctx.addIssue({ code: 'custom', message: `${p.type} point needs its reference` })
    }
  })

const fiberFields = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    coreCount: z.number().refine((n) => CORE_COUNTS.includes(n), 'coreCount must be one of 2,4,6,12,24,48'),
    cableType: z.string().trim().max(100).nullish(),
    status: z.enum(['PLANNED', 'LIVE', 'CUT']).default('PLANNED'),
    oltId: z.string().nullish(),
    ponPort: num(z.number().int().min(1).max(256).nullish()),
    cableTag: z.string().trim().max(100).nullish(),
    placement: z.enum(['IN', 'OUT']).nullish(),
    operatorId: z.string().nullish(),
    notes: z.string().trim().max(500).nullish(),
    images: z.array(z.string()).max(20).nullish(),
    fromSplitterOutput: z.object({ splitterId: z.string(), portNo: z.number().int().min(1) }).nullish(),
    points: z.array(pointSchema).min(2).max(200),
    segmentLaidMeters: z.array(num(z.number().min(0).nullable())).nullish(),
  })

// Zod 4 refuses `.partial()` on an object that already carries refinements, so
// the cross-field rules cannot be shared with the partial variant. That suits the
// semantics anyway: a PATCH carries a fragment, so `{ ponPort: 5 }` is legal when
// the stored fiber already has an OLT. The service re-checks both rules against
// the merged values once it has loaded the existing row.
export const createFiberSchema = fiberFields.superRefine((f, ctx) => {
  if ((f.oltId == null) !== (f.ponPort == null)) {
    ctx.addIssue({ code: 'custom', message: 'oltId and ponPort go together' })
  }
  if (f.fromSplitterOutput && f.oltId) {
    ctx.addIssue({ code: 'custom', message: 'A fiber fed by a splitter has no OLT port of its own' })
  }
})

export const updateFiberSchema = fiberFields.partial()

export const segmentLaidSchema = z.object({ fiberLaidMeters: num(z.number().min(0).nullable()) })

export const cutSchema = z.object({ segmentId: z.string(), note: z.string().trim().max(300).nullish() })

// Query values arrive as strings. z.coerce would turn '' into 0 and fail the
// min instead of falling back, so preprocess supplies the default itself.
export const junctionsQuerySchema = z.object({
  radius: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 10 : Number(v)),
    z.number().min(1).max(100),
  ),
})

export const mergePointsSchema = z.object({
  pointIds: z.array(z.string()).min(2).max(50),
  type: z.enum(['CLOSURE', 'POP']),
  popId: z.string().nullish(),
  kind: z.string().trim().max(50).nullish(),
})
