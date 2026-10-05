/**
 * What a partner earns for one customer who signs up.
 *
 * Most partners are paid from the rate card (speed × plan length). A DSA is
 * paid a flat amount per customer, whatever plan the customer takes — the
 * business's rule, so they have no calculator to show either.
 */
export const DSA_FIXED_AMOUNT = 500

const FIXED_BY_TYPE = { DSA: DSA_FIXED_AMOUNT }

/** The flat amount this partner type earns per customer, or null if they are paid from the rate card. */
export const fixedAmountFor = (partnerType) => FIXED_BY_TYPE[partnerType] ?? null

/** The amount to record for one conversion, given the rate-card row for the plan taken. */
export const commissionFor = (partnerType, rate) => fixedAmountFor(partnerType) ?? rate.amount
