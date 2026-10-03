import { ApiError } from '../../lib/api-error.js'
import { isServiceable } from '../../lib/serviceable.js'

const MIN_QUERY_LENGTH = 3
const MAX_RESULTS = 10

/**
 * Partner-facing search over OUR building registry.
 *
 * A partner types a name and picks from what we actually hold, rather than
 * searching Google and hoping the pin lands within a matching radius. That
 * removes the whole class of "the coordinates were 200m out" failures.
 *
 * The tradeoff, accepted knowingly: this lets a partner look our buildings up
 * by name. It is contained rather than open — a real query is required (no
 * blank-search enumeration), results are capped, the route is rate limited,
 * and each row carries ONLY what is needed to choose one. No home pass, no
 * zone, no operator, no surveyor, no coordinates.
 */
export function createBuildingSearchService({ buildingRepository }) {
  const toPartnerRow = (b) => ({
    id: b.id,
    buildingName: b.buildingName,
    formattedAddress: b.formattedAddress,
    isServiceable: isServiceable(b),
  })

  return {
    async search(query) {
      const q = (query ?? '').trim()
      if (q.length < MIN_QUERY_LENGTH) {
        throw ApiError.badRequest(`Type at least ${MIN_QUERY_LENGTH} characters to search`)
      }
      const rows = await buildingRepository.searchForPartner(q, MAX_RESULTS)
      // Built field by field, never by spreading a building — a spread is how
      // internal columns escape the first time somebody adds one.
      return rows.map(toPartnerRow)
    },

    /**
     * Re-checked on the server at referral time. The client tells us which
     * building was picked; it does not get to tell us whether we serve it.
     */
    async assertServiceable(buildingId) {
      const rows = await buildingRepository.searchForPartner(null, 1, buildingId)
      const building = rows[0]
      if (!building) throw ApiError.badRequest('Pick a building from the list')
      if (!isServiceable(building)) {
        throw ApiError.badRequest('We cannot serve that building yet')
      }
    },
  }
}
