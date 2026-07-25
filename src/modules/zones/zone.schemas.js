import { z } from 'zod'

const boundaryPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

export const createZoneSchema = z.object({
  name: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  // Polygon needs at least 3 vertices; capped to keep payloads sane.
  boundary: z.array(boundaryPointSchema).min(3).max(100).nullish(),
})

export const updateZoneSchema = createZoneSchema.partial()
