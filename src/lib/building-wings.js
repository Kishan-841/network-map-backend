/**
 * Building wings (spec 2026-10-14): pure rules shared by the service and its
 * tests. A building's wing COUNT lives on BuildingDetails.wings; the wings
 * placed on the map are BuildingWing rows. Once every wing is placed the
 * building's own home pass / Live are derived from its wings.
 */
export const WING_NAME_MAX = 40

export function normaliseWings(wings = []) {
  return wings.map((wing) => ({
    ...(wing.id ? { id: wing.id } : {}),
    name: String(wing.name ?? '').trim(),
    latitude: Number(wing.latitude),
    longitude: Number(wing.longitude),
    homePass: Number(wing.homePass ?? 0),
    isLive: Boolean(wing.isLive),
  }))
}

/** Every reason this set of wings cannot be saved for a building with `wingCount` wings. */
export function wingSetErrors(wings, wingCount) {
  if (wings.length === 0) return []
  const errors = []
  if (!wingCount) errors.push('Set the number of wings before locating them')
  else if (wings.length > wingCount) {
    errors.push(`This building has ${wingCount} wing${wingCount === 1 ? '' : 's'} — ${wings.length} cannot be placed`)
  }
  const seen = new Set()
  for (const raw of wings) {
    const wing = { ...raw, name: String(raw.name ?? '').trim() }
    if (!wing.name) errors.push('Every wing needs a name')
    else if (wing.name.length > WING_NAME_MAX) errors.push(`Wing names are at most ${WING_NAME_MAX} characters`)
    else {
      const key = wing.name.toLowerCase()
      if (seen.has(key)) errors.push(`Wing name "${wing.name}" is used twice`)
      seen.add(key)
    }
    if (!Number.isInteger(wing.homePass) || wing.homePass < 0) errors.push('Home pass must be a whole number, 0 or more')
    const badLat = !Number.isFinite(wing.latitude) || wing.latitude < -90 || wing.latitude > 90
    const badLng = !Number.isFinite(wing.longitude) || wing.longitude < -180 || wing.longitude > 180
    if (badLat || badLng) errors.push(`Wing ${wing.name || '(unnamed)'} has an invalid location`)
  }
  return [...new Set(errors)]
}

export const isComplete = (placedCount, wingCount) =>
  Number.isInteger(wingCount) && wingCount > 0 && placedCount === wingCount

export function deriveTotals(wings) {
  return {
    isLive: wings.some((wing) => wing.isLive),
    homePass: wings.reduce((sum, wing) => sum + (wing.homePass ?? 0), 0),
  }
}
