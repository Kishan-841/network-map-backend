import { z } from 'zod'

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

export const FIBER_TYPES = ['2 core', '4 core', '6 core', '12 core', '24 core', '48 core']

// Each segment is one polyline WITH its own cable type — a route can start
// as 2 core and continue as 4 core (the type switch starts a new segment).
// A branch is a segment whose first point sits on another segment's vertex.
const segmentSchema = z.object({
  fiberType: z.enum(FIBER_TYPES),
  points: z.array(pointSchema).min(2).max(200),
})

export const createFiberRouteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  segments: z.array(segmentSchema).min(1).max(50),
  fiberId: z.string().trim().min(1).max(100),
  placement: z.enum(['IN', 'OUT']),
  remark: z.string().trim().max(500).nullish(),
  images: z.array(z.string()).max(20).nullish(),
})

export const updateFiberRouteSchema = createFiberRouteSchema.partial()
