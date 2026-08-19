import { z } from 'zod'

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

// Each segment is one polyline; a branch starts at another segment's vertex.
const segmentSchema = z.array(pointSchema).min(2).max(200)

export const createFiberRouteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  segments: z.array(segmentSchema).min(1).max(50),
})

export const updateFiberRouteSchema = createFiberRouteSchema.partial()
