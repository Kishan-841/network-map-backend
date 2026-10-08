import { z } from 'zod'
import { PERMISSION_STATUSES, remarkSchema } from '../buildings/building.schemas.js'

export const listQuerySchema = z.object({
  status: z.enum(PERMISSION_STATUSES).optional(),
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
