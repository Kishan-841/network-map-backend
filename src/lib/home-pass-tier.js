/**
 * Home-pass tiers — how big a building is, as a name people can say out loud.
 *
 * THE definition. The buildings list, the dashboard breakdown and any future
 * report all read these boundaries from here, so a tier can never mean two
 * different things in two places.
 *
 * Two readings were settled when this was specified:
 *  - The stated ranges overlapped at 200 / 500 / 1000. The upper bound wins,
 *    matching how they were written ("1-200 HP" reads as up to and including
 *    200), so a building with exactly 200 home pass is Bronze, not Silver.
 *  - Platinum was named for both 1000-5000 and "more than 5000", so it is
 *    simply everything from 1000 up — there is no fifth tier.
 *
 * A building with no home pass recorded is UNRATED, never Bronze: "nobody has
 * measured this yet" is a different fact from "this one is small", and 19 of
 * the 73 buildings in development have no figure at all.
 */
export const HOME_PASS_TIERS = [
  { key: 'BRONZE', label: 'Bronze', min: 1, max: 200 },
  { key: 'SILVER', label: 'Silver', min: 201, max: 500 },
  { key: 'GOLD', label: 'Gold', min: 501, max: 1000 },
  { key: 'PLATINUM', label: 'Platinum', min: 1001, max: null },
]

/** Tier key for a home-pass figure, or null when there is no figure. */
export function homePassTier(homePass) {
  if (homePass === null || homePass === undefined) return null
  const value = Number(homePass)
  if (!Number.isFinite(value) || value < 1) return null
  return HOME_PASS_TIERS.find((t) => value >= t.min && (t.max === null || value <= t.max))?.key ?? null
}

/** "201–500" / "1001+" — the range shown beside a tier name. */
export function tierRangeLabel({ min, max }) {
  return max === null ? `${min}+` : `${min}–${max}`
}
