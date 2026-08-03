import { z } from 'zod'

export const listLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  userId: z.string().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'SURVEYOR']).optional(),
  module: z.string().optional(),
  action: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILED']).optional(),
  ipAddress: z.string().optional(),
  search: z.string().optional(),
})
