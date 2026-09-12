import { z } from 'zod'

export const RATIO_PORTS = { R1_2: 2, R1_4: 4, R1_8: 8, R1_16: 16 }

const coord = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }

export const createClosureSchema = z.object({
  ...coord,
  kind: z.string().trim().max(50).nullish(),
  buildingId: z.string().nullish(),
  notes: z.string().trim().max(500).nullish(),
})
export const updateClosureSchema = createClosureSchema.partial()

export const createSplitterSchema = z.object({
  ratio: z.enum(Object.keys(RATIO_PORTS)),
  location: z.enum(['WAN', 'LAN']).default('WAN'),
  inputFiberId: z.string().nullish(),
})
export const updateSplitterSchema = createSplitterSchema.partial()

export const setOutputSchema = z.object({
  toBuildingId: z.string().nullish(),
  label: z.string().trim().max(100).nullish(),
})
