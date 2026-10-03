/**
 * Attach each partner's figures to their row.
 *
 * `counts` ride along on the partner query for free; the money comes from a
 * separate grouped aggregate rather than including every earning row, because
 * a productive partner would otherwise ship hundreds of rows per screen to
 * produce one number.
 */
export function withPartnerTotals(partners, earningSums = []) {
  const byPartner = new Map(earningSums.map((row) => [row.partnerId, row._sum?.amount ?? 0]))
  return partners.map(({ _count, ...partner }) => ({
    ...partner,
    // A lead is a customer the partner sent in; an earning exists only for a
    // lead that converted, so it counts the ones who actually signed up.
    customersAdded: _count?.leads ?? 0,
    customersActivated: _count?.earnings ?? 0,
    // Zero, never undefined: the column is money and must always render as an
    // amount rather than blanking out for a partner who has earned nothing.
    totalEarnings: byPartner.get(partner.id) ?? 0,
  }))
}
