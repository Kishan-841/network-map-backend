import { z } from 'zod'

// Assign / distribute a batch of buildings to one sales user. Ids only — the
// server decides everything else (who may assign, whose pool, history).
export const assignBuildingsSchema = z.object({
  buildingIds: z.array(z.string().min(1)).min(1, 'Select at least one building').max(500),
  assignedToId: z.string().min(1, 'Choose who to assign to'),
})

export const historyQuerySchema = z.object({
  buildingId: z.string().min(1),
})

export const searchBuildingsQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least two characters').max(120),
})

const latitude = z.number({ invalid_type_error: 'Location is required' }).min(-90).max(90)
const longitude = z.number({ invalid_type_error: 'Location is required' }).min(-180).max(180)

// Check IN: location is forced (both coords required) and a selfie is required.
export const checkInSchema = z.object({
  buildingId: z.string().min(1),
  checkInLat: latitude,
  checkInLng: longitude,
  selfieUrl: z.string().trim().min(1, 'A selfie is required'),
  note: z.string().trim().max(500).optional(),
})

export const visitActivitySchema = z.object({
  type: z.enum(['DESK', 'UMBRELLA', 'LIFT']),
})

// Check OUT also forces the location.
export const checkOutSchema = z.object({
  checkOutLat: latitude,
  checkOutLng: longitude,
})

// Kept deliberately simple — the calling team collects the detail later.
export const createInquirySchema = z.object({
  buildingId: z.string().min(1),
  customerName: z.string().trim().min(1, 'Customer name is required').max(120),
  phone: z.string().trim().min(6, 'Enter a valid phone number').max(20),
  // Optional: '' from the form becomes undefined, otherwise a real email.
  email: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().email().optional()),
  // Links the inquiry to the actor's open visit, when raised during one.
  visitId: z.string().min(1).optional(),
})

// Filters shared by the activity lists and the dashboard: a date range, and a
// narrowing to one team member or building. Dates arrive as ISO strings.
export const activityQuerySchema = z.object({
  buildingId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export const dashboardQuerySchema = activityQuerySchema
