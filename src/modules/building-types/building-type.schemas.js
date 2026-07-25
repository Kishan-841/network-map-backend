import { z } from 'zod'

export const buildingTypeSchema = z.object({
  name: z.string().min(1).max(50),
})
