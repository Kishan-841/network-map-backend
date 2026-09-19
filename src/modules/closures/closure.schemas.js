import { z } from 'zod'
import { CORE_COUNTS, FIBER_TYPES } from '../../lib/fiber-constants.js'

export const RATIO_PORTS = { R1_2: 2, R1_4: 4, R1_6: 6, R1_8: 8, R1_16: 16 }

/**
 * The boxes the field actually fits. Stored as the plain word so the closures
 * recorded before this keep reading correctly; the screen adds the way count
 * ("2 way tiffin", "4 way compass").
 */
export const CLOSURE_KINDS = ['Jumbo', 'Tiffin', 'Compass', 'FDC', 'PatchPanel']
/** Tubes in the cable a closure sits on. 0 is a real answer. */
export const TUBE_COUNTS = [0, 1, 2, 3, 4]

const coord = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }

// A count that arrives as '' from a form means "not recorded", not zero.
const count = (values, message) =>
  z
    .preprocess((v) => (v === '' || v === null ? undefined : v), z.number().int().nullish())
    .refine((v) => v == null || values.includes(v), message)

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
})
export const updateClosureSchema = createClosureSchema.partial()

export const createSplitterSchema = z.object({
  ratio: z.enum(Object.keys(RATIO_PORTS)),
  location: z.enum(['S1', 'S2', 'S3']).default('S1'),
  fiberType: z.enum(['MAIN', 'SUB']).nullish(),
  inputFiberId: z.string().nullish(),
})
export const updateSplitterSchema = createSplitterSchema.partial()

export const setOutputSchema = z.object({
  toBuildingId: z.string().nullish(),
  label: z.string().trim().max(100).nullish(),
})
