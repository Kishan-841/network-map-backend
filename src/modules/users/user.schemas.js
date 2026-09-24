import { z } from 'zod'

const roleSchema = z.enum([
  'ADMIN',
  'MANAGER',
  'SURVEYOR',
  'ACQUISITION_AGENT',
  'ACQUISITION_LEAD',
  'SUPERVISOR',
  'SALES_MANAGER',
  'TEAM_LEADER',
  'SALES_EXECUTIVE',
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
  // Field-sales hierarchy — only meaningful for the sales roles; the service
  // clears it for everyone else and checks the referenced roles.
  managerId: z.string().min(1).nullish(),
  teamLeaderId: z.string().min(1).nullish(),
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

// Bulk create of the sales hierarchy from a sheet. Kept permissive on purpose:
// each field is validated per-row in the service so the response can report
// every bad row (all-or-nothing), instead of zod rejecting the whole payload.
export const bulkCreateUsersSchema = z.object({
  users: z
    .array(
      z
        .object({
          name: z.string().trim().optional().default(''),
          email: z.string().trim().optional().default(''),
          password: z.string().optional().default(''),
          role: z.string().trim().optional().default(''),
          reportsToEmail: z.string().trim().optional().default(''),
        })
        .strip(),
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
    managerId: z.string().min(1).nullable(),
    teamLeaderId: z.string().min(1).nullable(),
  })
  .partial()

// Accesses an ADMIN hands to individual users (Users → Assign accesses).
// Deliberately NOT part of updateUserSchema: that route is open to
// acquisition leads, and an unknown key there is dropped, not applied.
export const userAccessSchema = z
  .object({
    canManageFiber: z.boolean(),
    canEditBuildings: z.boolean(),
  })
  .partial()
  .strict()
  // One tick per request, or both — but a PATCH that says nothing is a bug in
  // the caller, not an instruction to change nothing.
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one access to change',
  })
