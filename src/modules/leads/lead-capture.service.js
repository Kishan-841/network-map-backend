import { ApiError } from '../../lib/api-error.js'
import { haversineMeters, boundingBox } from '../../lib/geo.js'

/** How close a pin has to be to count as the same building. */
const MATCH_RADIUS_METERS = 150

export function createLeadCaptureService({ buildingRepository, leadRepository }) {
  /**
   * Line a searched place up with our registry.
   *
   * Returns the verdict AND the building id — the id is for the server to
   * link the lead with; the route never puts it in a response. A partner
   * gets a colour, not a record.
   */
  async function matchPlace({ buildingId, placeId, latitude, longitude }) {
    let match = null

    // A building the partner PICKED from our own search — the mobile app
    // searches our registry, not Google (PRD §6.1). The id is a pointer, not a
    // verdict: it is fetched again through the very method the search uses,
    // so an id for a building partners cannot see links nothing, and whether
    // we serve it is read from our row, never from anything the client sent.
    if (buildingId) {
      const [picked] = await buildingRepository.searchForPartner(null, 1, buildingId)
      match = picked ?? null
    }

    if (!match && placeId) match = await buildingRepository.findByPlaceId(placeId)

    if (!match && latitude != null && longitude != null) {
      const box = boundingBox(latitude, longitude, MATCH_RADIUS_METERS)
      const nearby = await buildingRepository.findWithinBounds(box)
      const inRange = nearby
        .map((b) => ({ b, d: haversineMeters(latitude, longitude, b.latitude, b.longitude) }))
        .filter(({ d }) => d <= MATCH_RADIUS_METERS)
        .sort((x, y) => x.d - y.d)
      // A building we SERVE beats a merely nearer one: towers of a complex sit
      // metres apart, and reporting the unlit neighbour would be wrong.
      match = (inRange.find(({ b }) => b.isLive) ?? inRange[0])?.b ?? null
    }

    if (!match) return { match: 'NOT_FOUND', buildingId: null }
    return { match: match.isLive ? 'LIVE' : 'IN_REGISTRY', buildingId: match.id }
  }

  return {
    matchPlace,

    /**
     * Capture the lead — whether or not we know the building.
     *
     * That is the point of the rework: refusing a lead for a building we do
     * not serve threw away exactly the information that says where to build
     * next (partner-network.md §4.1).
     */
    async capture(input, partner) {
      if (partner?.status !== 'APPROVED') {
        throw ApiError.forbidden('Your account is not approved yet')
      }

      // The client tells us WHAT they searched for. It does not get to tell us
      // whether we serve it — that is re-resolved here every time.
      const { match, buildingId } = await matchPlace(input)

      const existing = await leadRepository.findOpenByMobile(input.customerMobile)

      const created = await leadRepository.create({
        partnerId: partner.id,
        // A snapshot: re-assigning this partner later must not move the
        // commission on leads they have already sent.
        employeeId: partner.onboardedById ?? null,
        customerName: input.customerName,
        customerMobile: input.customerMobile,
        address: input.address ?? null,
        note: input.note ?? null,
        requirementMbps: input.requirementMbps ?? null,
        searchedPlaceId: input.placeId ?? null,
        searchedPlaceName: input.placeName ?? null,
        buildingMatch: match,
        buildingId,
        status: existing ? 'DUPLICATE' : 'NEW',
        duplicateOfId: existing?.id ?? null,
      })

      await leadRepository.recordEvent({
        leadId: created.id,
        fromStatus: null,
        toStatus: created.status,
      })
      return created
    },
  }
}
