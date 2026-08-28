import { z } from 'zod'

const email = z.string().trim().toLowerCase().email()
// Indian mobile: 10 digits, never starting 0-5.
const mobile = z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number')
const password = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[a-zA-Z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a number')

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['AGENT', 'SOCIETY_REPRESENTATIVE', 'RETAIL_SHOP', 'DSA']),
  companyName: z.string().trim().max(150).optional(),
  mobile,
  email,
  password,
  hasGst: z.boolean().optional().default(false),
  inviteToken: z.string().trim().min(10).max(200).optional(),
})

export const loginSchema = z.object({ email, password: z.string().min(1) })
export const otpRequestSchema = z.object({ email })
export const otpVerifySchema = z.object({ email, code: z.string().trim().regex(/^\d{6}$/) })
