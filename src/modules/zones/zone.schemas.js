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

export const listZonesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
})

export const bulkZoneSchema = z.object({
  zones: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        city: z.string().trim().min(1).max(100),
      }),
    )
    .min(1)
    .max(500),
})
