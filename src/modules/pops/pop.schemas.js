import { z } from 'zod'

const coord = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }

// zoneId is required here and optional in the partial below: every NEW POP
// must say where it sits, because who may see it follows its zone.
export const createPopSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ...coord,
  zoneId: z.string().min(1),
  notes: z.string().trim().max(500).nullish(),
})
export const updatePopSchema = createPopSchema.partial()

export const createOltSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ponPortCount: z.number().int().min(1).max(256),
})
export const updateOltSchema = createOltSchema.partial()
