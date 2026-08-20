import { z } from 'zod'

const roleSchema = z.enum([
  'ADMIN',
  'MANAGER',
  'SURVEYOR',
  'ACQUISITION_AGENT',
  'ACQUISITION_LEAD',
])

// Indian PIN codes: exactly 6 digits, never starting with 0.
const pincodeSchema = z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Must be a 6-digit PIN code')

// Policy chosen for field teams: 8+ chars with a letter and a number —
// balances account security with typability on mobile keyboards.
const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[a-zA-Z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a number')

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: passwordSchema,
  role: roleSchema,
  zoneIds: z.array(z.string().min(1)).max(200).optional(),
  // Acquisition agents are mapped to one city + its pincodes.
  cityId: z.string().min(1).nullish(),
  pincodes: z.array(pincodeSchema).max(50).optional(),
})

export const bulkZoneAssignSchema = z.object({
  assignments: z
    .array(
      z.object({
        email: z.string().trim().email(),
        zoneNames: z.array(z.string().trim().min(1)).min(1).max(200),
      }),
    )
    .min(1)
    .max(500),
})

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
  role: roleSchema.optional(),
})

export const updateUserSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    password: passwordSchema,
    role: roleSchema,
    isActive: z.boolean(),
    zoneIds: z.array(z.string().min(1)).max(200),
    cityId: z.string().min(1).nullable(),
    pincodes: z.array(pincodeSchema).max(50),
  })
  .partial()
