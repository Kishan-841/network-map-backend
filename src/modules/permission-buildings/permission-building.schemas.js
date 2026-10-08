import { z } from 'zod'
import { PERMISSION_STATUSES, remarkSchema } from '../buildings/building.schemas.js'
import { APPROVAL_STATUSES } from './approval.js'

export const listQuerySchema = z.object({
  status: z.enum(PERMISSION_STATUSES).optional(),
  approval: z.enum(APPROVAL_STATUSES).optional(),
  // ADMIN only — ignored for a Permission Executive (their scope is themselves).
  createdById: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
})

// The remark is optional here only so the service can answer with a clear
// message ("A remark is required …") instead of the generic validation error.
export const visitSchema = z
  .object({
    remark: remarkSchema.optional(),
    permissionStatus: z.enum(PERMISSION_STATUSES).optional(),
  })
  .strict()

// Phase 2 — an ADMIN's decision. zoneId / reason are optional here only so the
// service answers with the clear message ("Pick a zone", "A reason is required").
export const approveSchema = z
  .object({
    zoneId: z.string().trim().max(100).optional(),
    note: remarkSchema.optional(),
  })
  .strict()

export const rejectSchema = z
  .object({
    reason: remarkSchema.optional(),
  })
  .strict()
