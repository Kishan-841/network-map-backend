import { z } from 'zod'

export const createCitySchema = z.object({
  name: z.string().trim().min(1).max(100),
})

export const updateCitySchema = createCitySchema.partial()
