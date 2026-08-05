import { z } from 'zod'

export const dashboardQuerySchema = z.object({
  operatorId: z.string().optional(),
})
