import { z } from 'zod'

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const digits = (s) => String(s ?? '').replace(/\s+/g, '')

/** What a partner (or an admin) types. The number stays a string: leading zeros matter. */
export const bankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(2, 'Enter the name as printed in the passbook').max(120),
    accountNumber: z
      .string()
      .transform(digits)
      .pipe(z.string().regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits')),
    ifsc: z
      .string()
      .transform((s) => s.trim().toUpperCase())
      .pipe(z.string().regex(IFSC_PATTERN, 'Enter a valid IFSC code, like HDFC0001234')),
    branchName: z.string().trim().min(2, 'Enter the branch').max(120),
    bankName: z.string().trim().max(120).optional().or(z.literal('')),
  })
  .strict()

/** The audit log's view of a bank-details request: never the full number. */
export function redactBankBody(body = {}) {
  const { accountNumber, ...rest } = body ?? {}
  return { ...rest, accountLast4: digits(accountNumber).slice(-4) }
}
