import { ApiError } from '../../lib/api-error.js'

export const LOCKED_MESSAGE = 'Your bank details are locked. Contact your partner manager to change them.'
const mask = (last4) => `XXXXXX${last4}`

/**
 * A partner's bank account: validation lives in the schema; this owns the
 * edit lock, the encryption and who may see the full number. The full number
 * leaves only through getFull/saveByAdmin (ADMIN) and payeesFor (payouts).
 */
export function createBankAccountService({ bankAccountRepository, partnerRepository, cipher }) {
  const toData = (input, updatedById) => ({
    accountHolderName: input.accountHolderName,
    accountNumberEnc: cipher.encrypt(input.accountNumber),
    accountLast4: input.accountNumber.slice(-4),
    ifsc: input.ifsc,
    bankName: input.bankName || null,
    branchName: input.branchName,
    updatedById,
  })
  const masked = (row) =>
    row && {
      accountHolderName: row.accountHolderName,
      accountNumberMasked: mask(row.accountLast4),
      ifsc: row.ifsc,
      bankName: row.bankName,
      branchName: row.branchName,
    }
  const full = (row) =>
    row && {
      accountHolderName: row.accountHolderName,
      accountNumber: cipher.decrypt(row.accountNumberEnc),
      accountLast4: row.accountLast4,
      ifsc: row.ifsc,
      bankName: row.bankName,
      branchName: row.branchName,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null,
    }

  const isEditableByPartner = (status, hasRow) =>
    status === 'REGISTERED' || status === 'REJECTED' || (status === 'APPROVED' && !hasRow)

  return {
    isEditableByPartner,

    async getMasked(partnerId) {
      return masked(await bankAccountRepository.findByPartnerId(partnerId))
    },

    async saveByPartner(partner, input) {
      const existing = await bankAccountRepository.findByPartnerId(partner.id)
      if (!isEditableByPartner(partner.status, Boolean(existing))) throw ApiError.conflict(LOCKED_MESSAGE)
      return masked(await bankAccountRepository.upsert(partner.id, toData(input, null)))
    },

    async getFull(partnerId) {
      if (!(await partnerRepository.findById(partnerId))) throw ApiError.notFound('Partner not found')
      return full(await bankAccountRepository.findByPartnerId(partnerId))
    },

    async saveByAdmin(partnerId, input, actor) {
      if (!(await partnerRepository.findById(partnerId))) throw ApiError.notFound('Partner not found')
      return full(await bankAccountRepository.upsert(partnerId, toData(input, actor.id)))
    },

    async payeesFor(partnerIds) {
      const rows = await bankAccountRepository.findManyByPartnerIds([...new Set(partnerIds)])
      const payee = (r) => {
        const base = {
          accountHolderName: r.accountHolderName,
          ifsc: r.ifsc,
          bankName: r.bankName,
          branchName: r.branchName,
        }
        try {
          return { ...base, accountNumber: cipher.decrypt(r.accountNumberEnc) }
        } catch {
          // One unreadable row (wrong key, damaged value) must not take the
          // whole payouts list down. Log the partner, never the value.
          console.error('[bank] unreadable account for partner', r.partnerId)
          return { ...base, accountNumber: null, unreadable: true }
        }
      }
      return new Map(rows.map((r) => [r.partnerId, payee(r)]))
    },
  }
}
