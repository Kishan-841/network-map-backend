import { haversineMeters, boundingBox } from '../../lib/geo.js'
import { isServiceable } from '../../lib/serviceable.js'

/**
 * How close a pin has to be to count as the same building. Google's
 * coordinate for a society is often the gate or the centroid, tens of metres
 * from where our surveyor stood.
 */
const MATCH_RADIUS_METERS = 150

export function createFeasibilityService({ buildingRepository, demandRepository }) {
  return {
    /**
     * Answer "can you serve this building?" and NOTHING else.
     *
     * The return value is built field by field, never by spreading a
     * building — a spread is how internal data escapes the first time
     * somebody adds a column. A partner who could walk this endpoint across
     * a grid of coordinates would be downloading our coverage map, so the
     * response is a single word and the route is rate limited.
     */
    async check({ placeId, latitude, longitude, name }, partnerId) {
      let match = placeId ? await buildingRepository.findByPlaceId(placeId) : null

      if (!match) {
        const box = boundingBox(latitude, longitude, MATCH_RADIUS_METERS)
        const nearby = await buildingRepository.findWithinBounds(box)
        const inRange = nearby
          .map((b) => ({ b, d: haversineMeters(latitude, longitude, b.latitude, b.longitude) }))
          .filter(({ d }) => d <= MATCH_RADIUS_METERS)
          .sort((x, y) => x.d - y.d)

        // A serviceable building in range beats a merely nearer one. Towers of
        // the same complex sit metres apart; picking the closest pin was
        // reporting "not available" for a society whose neighbour we serve.
        match = (inRange.find(({ b }) => isServiceable(b)) ?? inRange[0])?.b ?? null
      }

      if (isServiceable(match)) return { verdict: 'SERVICEABLE' }

      // Everything we cannot serve is worth knowing about: "fourteen people
      // asked about this society" is real input to network planning, and it
      // costs one row.
      if (demandRepository) {
        await demandRepository.record({
          partnerId,
          placeId: placeId ?? null,
          name: name ?? null,
          latitude,
          longitude,
          matchedBuildingId: match?.id ?? null,
        })
      }

      return { verdict: match ? 'NOT_SERVICEABLE' : 'NOT_SURVEYED' }
    },
  }
}
