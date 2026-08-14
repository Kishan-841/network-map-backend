import { z } from 'zod'

export const createOperatorSchema = z.object({
  name: z.string().trim().min(1).max(100),
  cityId: z.string().nullish(),
})

export const updateOperatorSchema = createOperatorSchema.partial()

export const listOperatorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
})

export const operatorImportSchema = z.object({
  rows: z
    .array(
      z.object({
        operator: z.string().trim().min(1).max(100),
        zone: z.string().trim().min(1).max(100),
        city: z.string().trim().max(100).optional().default(''),
        email: z.string().trim().email(),
      }),
    )
    .min(1)
    .max(1000),
})
