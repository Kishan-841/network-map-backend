/**
 * What a partner earns for one customer who signs up.
 *
 * Agents, society representatives and retail shops only pass a lead on — our
 * sales team contacts the customer and converts them — so they are paid a
 * flat amount per customer, whatever plan the customer takes, and have no
 * calculator to show. A DSA works the lead themselves until it converts, so a
 * DSA is paid from the rate card (speed × plan length), like the calculator
 * quotes. A type not listed here is paid from the rate card.
 */
export const FLAT_AMOUNT = 500
export const FLAT_PAY_TYPES = ['AGENT', 'SOCIETY_REPRESENTATIVE', 'RETAIL_SHOP']

/** { AGENT: 500, … } — the staff convert preview reads this. */
export const FIXED_AMOUNT_BY_TYPE = Object.fromEntries(FLAT_PAY_TYPES.map((type) => [type, FLAT_AMOUNT]))

/** The flat amount this partner type earns per customer, or null if they are paid from the rate card. */
export const fixedAmountFor = (partnerType) => FIXED_AMOUNT_BY_TYPE[partnerType] ?? null

/** The amount to record for one conversion, given the rate-card row for the plan taken. */
export const commissionFor = (partnerType, rate) => fixedAmountFor(partnerType) ?? rate.amount
