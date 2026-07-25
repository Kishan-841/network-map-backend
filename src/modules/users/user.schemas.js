import { z } from 'zod'

const roleSchema = z.enum(['ADMIN', 'MANAGER', 'SURVEYOR'])

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
})

export const updateUserSchema = z
  .object({
    name: z.string().min(1),
    role: roleSchema,
    isActive: z.boolean(),
  })
  .partial()
