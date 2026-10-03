import { z } from 'zod'

// Indian mobile: 10 digits, never starting 0-5. The partner's identity.
const mobile = z.string().trim().regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number')
const email = z.string().trim().toLowerCase().email()

export const otpRequestSchema = z.object({ mobile })

/**
 * What a partner may change about their own account: only the language the
 * app speaks to them in. Status, mobile and the rest belong to staff — so
 * anything else in the body is refused rather than ignored.
 */
export const updateMeSchema = z.object({ preferredLanguage: z.enum(['EN', 'HI', 'MR']) }).strict()
export const otpVerifySchema = z.object({ mobile, code: z.string().trim().regex(/^\d{6}$/) })

/**
 * Signup asks for as little as possible (partner-network.md §0). No password —
 * there is no such thing — and email is optional, because many partners have
 * none. The signupToken proves the number already passed a code.
 */
export const registerSchema = z.object({
  signupToken: z.string().min(10),
  mobile,
  name: z.string().trim().min(1).max(120),
  type: z.enum(['AGENT', 'SOCIETY_REPRESENTATIVE', 'RETAIL_SHOP', 'DSA']),
  companyName: z.string().trim().max(150).optional(),
  email: email.optional().or(z.literal('')),
  preferredLanguage: z.enum(['EN', 'HI', 'MR']).optional().default('EN'),
  inviteToken: z.string().trim().min(10).max(200).optional(),
})
