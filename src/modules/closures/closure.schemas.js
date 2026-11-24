import { z } from 'zod'
import { CABLE_DIRECTIONS, CLOSURE_CABLE_CORES, CORE_COUNTS, FIBER_TYPES, MAX_FLOOR, SPLITTER_PLACEMENTS } from '../../lib/fiber-constants.js'

export const RATIO_PORTS = { R1_2: 2, R1_4: 4, R1_6: 6, R1_8: 8, R1_16: 16 }

/**
 * The boxes the field actually fits. Stored as the plain word so the closures
 * recorded before this keep reading correctly; the screen adds the way count
 * ("2 way tiffin", "4 way compass").
 */
export const CLOSURE_KINDS = ['Jumbo', 'Tiffin', 'Compass', 'FDC', 'PatchPanel']
/** Tubes in the cable a closure sits on. 0 is a real answer. */
export const TUBE_COUNTS = [0, 1, 2, 3, 4]

/** Same shape and cap as Fiber.images / Pop.images. Shared with the draw-time newClosure. */
export const closureImagesSchema = z.array(z.string()).max(20).nullish()

const coord = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }

// A count that arrives as '' from a form means "not recorded", not zero.
const count = (values, message) =>
  z
    .preprocess((v) => (v === '' || v === null ? undefined : v), z.number().int().nullish())
    .refine((v) => v == null || values.includes(v), message)

/**
 * The cables at a closure: any number In and Out, each with an optional cable
 * type, core count and the fiber ID the user types. Sending the list replaces
 * what is stored; leaving it out keeps it.
 */
export const closureCablesSchema = z
  .array(
    z.object({
      direction: z.enum(CABLE_DIRECTIONS),
      cableType: z.enum(FIBER_TYPES).nullish(),
      coreCount: count(CLOSURE_CABLE_CORES, 'Cores must be one of 2, 4, 6, 8, 12, 24, 48'),
      cableTag: z
        .string()
        .trim()
        .max(60)
        .nullish()
        .transform((v) => v || null),
    }),
  )
  .max(40)
  .optional()

export const createClosureSchema = z.object({
  ...coord,
  // Still a loose string: closures recorded before the list existed may hold
  // anything, and refusing to save an edit of one would be worse than allowing
  // an odd word. The form only ever offers CLOSURE_KINDS.
  kind: z.string().trim().max(50).nullish(),
  /// Which kind of cable the closure sits on — the fiber sheet's three.
  fiberType: z.enum(FIBER_TYPES).nullish(),
  tubeCount: count(TUBE_COUNTS, 'Tubes must be 0 to 4'),
  inCoreCount: count(CORE_COUNTS, 'Cores must be one of 2, 4, 6, 12, 24, 48'),
  outCoreCount: count(CORE_COUNTS, 'Cores must be one of 2, 4, 6, 12, 24, 48'),
  buildingId: z.string().nullish(),
  notes: z.string().trim().max(500).nullish(),
  // Photos of the box — upload-API URLs only (the service checks they are ours).
  images: closureImagesSchema,
  cables: closureCablesSchema,
})
export const updateClosureSchema = createClosureSchema.partial()

export const createSplitterSchema = z.object({
  ratio: z.enum(Object.keys(RATIO_PORTS)),
  location: z.enum(['S1', 'S2', 'S3']).default('S1'),
  fiberType: z.enum(['MAIN', 'SUB']).nullish(),
  inputFiberId: z.string().nullish(),
})
// Where a splitter sits inside a building — shared by create (POST /splitters) and edit.
const splitterPlaceFields = {
  wingId: z.string().min(1).max(100).nullish(),
  placement: z.enum(SPLITTER_PLACEMENTS).nullish(),
  floorNumber: z.number().int().min(1, 'Floor must be 1 or more').max(MAX_FLOOR, `Floor must be ${MAX_FLOOR} or less`).nullish(),
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
}
export const updateSplitterSchema = createSplitterSchema.partial().extend(splitterPlaceFields).partial()

/** A splitter fitted inside a building, at the pin the user dropped (spec 2026-11-24-splitter-in-building). */
export const createBuildingSplitterSchema = createSplitterSchema
  .extend({
    buildingId: z.string().min(1).max(100),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    ...splitterPlaceFields,
  })
  .superRefine((b, ctx) => {
    if (b.placement === 'FLOOR' && b.floorNumber == null) {
      ctx.addIssue({ code: 'custom', path: ['floorNumber'], message: 'Which floor?' })
    }
    if (b.placement !== 'FLOOR' && b.floorNumber != null) {
      ctx.addIssue({ code: 'custom', path: ['floorNumber'], message: 'A floor number goes with Floor only' })
    }
  })

export const setOutputSchema = z.object({
  toBuildingId: z.string().nullish(),
  label: z.string().trim().max(100).nullish(),
})
