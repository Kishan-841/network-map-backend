import { z } from 'zod'

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

// Each segment is one polyline; a branch starts at another segment's vertex.
const segmentSchema = z.array(pointSchema).min(2).max(200)

export const FIBER_TYPES = ['2 core', '4 core', '6 core', '12 core', '24 core', '48 core']

export const createFiberRouteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  segments: z.array(segmentSchema).min(1).max(50),
  fiberType: z.enum(FIBER_TYPES),
  fiberId: z.string().trim().min(1).max(100),
  placement: z.enum(['IN', 'OUT']),
  remark: z.string().trim().max(500).nullish(),
  images: z.array(z.string()).max(20).nullish(),
})

export const updateFiberRouteSchema = createFiberRouteSchema.partial()
