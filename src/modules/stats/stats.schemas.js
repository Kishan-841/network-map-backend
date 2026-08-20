import { z } from 'zod'

export const dashboardQuerySchema = z.object({
  operatorId: z.string().optional(),
  cityId: z.string().optional(),
})

export const acquisitionQuerySchema = z.object({
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  agentId: z.string().cuid().optional(),
})
