import { ApiError } from '../../lib/api-error.js'
import { haversineMeters, boundingBox } from '../../lib/geo.js'
import { isSimilarName } from '../../lib/name-similarity.js'

export function createBuildingService({ buildingRepository, storage }) {
  // Stored URLs are rendered as <a href>/<img src> — only accept files that
  // came from our own uploads API (blocks javascript:/foreign URLs).
  function assertOwnedUrl(url) {
    if (!storage?.keyFromUrl(url)) {
      throw ApiError.badRequest('File URL must come from the uploads API')
    }
  }

  return {
    async createBuilding(input, createdById) {
      const { details, permission, photos, ...building } = input
      photos?.forEach((photo) => assertOwnedUrl(photo.url))
      if (permission?.documentUrl) assertOwnedUrl(permission.documentUrl)
      return buildingRepository.create({
        ...building,
        createdById,
        // A surveyor adding a building means: surveyed, and viable for fiber
        // (user decision — ease of use over a manual status step). Admins
        // change feasibility later via the status endpoint when needed.
        feasibleStatus: 'FEASIBLE',
        surveyStatus: 'COMPLETED',
        details: details ? { create: details } : undefined,
        permission: permission ? { create: permission } : undefined,
        photos: photos?.length ? { create: photos } : undefined,
      })
    },

    async listBuildings(filters = {}) {
      const {
        zoneId,
        status,
        createdById,
        dateFrom,
        dateTo,
        search,
        latitude,
        longitude,
        radius,
        page = 1,
        pageSize = 20,
      } = filters
      const where = {}
      if (zoneId) where.zoneId = zoneId
      if (status) where.feasibleStatus = status
      if (createdById) where.createdById = createdById
      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = new Date(dateFrom)
        if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`)
      }
      if (search) {
        where.OR = [
          { buildingName: { contains: search, mode: 'insensitive' } },
          { formattedAddress: { contains: search, mode: 'insensitive' } },
          { zone: { name: { contains: search, mode: 'insensitive' } } },
        ]
      }

      const paginate = (total) => ({
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      })

      const hasRadius = latitude !== undefined && longitude !== undefined && radius !== undefined
      if (hasRadius) {
        // Radius needs an exact haversine pass after the bounding-box query, so
        // pagination happens in memory over the filtered set (map-scale only).
        const box = boundingBox(latitude, longitude, radius)
        where.latitude = { gte: box.minLat, lte: box.maxLat }
        where.longitude = { gte: box.minLon, lte: box.maxLon }

        const candidates = await buildingRepository.list(where, { skip: 0, take: 500 })
        const filtered = candidates.filter(
          (b) => haversineMeters(latitude, longitude, b.latitude, b.longitude) <= radius,
        )
        const start = (page - 1) * pageSize
        return { items: filtered.slice(start, start + pageSize), pagination: paginate(filtered.length) }
      }

      const [total, items] = await Promise.all([
        buildingRepository.count(where),
        buildingRepository.list(where, { skip: (page - 1) * pageSize, take: pageSize }),
      ])
      return { items, pagination: paginate(total) }
    },

    async getBuilding(id) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')
      return building
    },

    async updateStatus(id, { feasibleStatus, surveyStatus }) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')
      return buildingRepository.update(id, {
        ...(feasibleStatus && { feasibleStatus }),
        ...(surveyStatus && { surveyStatus }),
      })
    },

    async findNearby({ latitude, longitude, radiusMeters, name, placeId }) {
      const box = boundingBox(latitude, longitude, radiusMeters)
      const candidates = await buildingRepository.findWithinBounds(box)

      const withinRadius = candidates
        .map((building) => ({
          ...building,
          distanceMeters: Math.round(
            haversineMeters(latitude, longitude, building.latitude, building.longitude),
          ),
        }))
        .filter((building) => building.distanceMeters <= radiusMeters)

      // An exact placeId match is a duplicate no matter how far the GPS drifted.
      if (placeId && !withinRadius.some((b) => b.placeId === placeId)) {
        const exact = await buildingRepository.findByPlaceId(placeId)
        if (exact) {
          withinRadius.push({
            ...exact,
            distanceMeters: Math.round(
              haversineMeters(latitude, longitude, exact.latitude, exact.longitude),
            ),
          })
        }
      }

      return withinRadius
        .map((building) => ({
          ...building,
          samePlaceId: Boolean(placeId) && building.placeId === placeId,
          similarName: name ? isSimilarName(name, building.buildingName) : false,
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
    },

    async addPhoto(buildingId, { type, url }, user) {
      // Permission letters feed the legal permission record — surveyors may not set them.
      if (type === 'PERMISSION_LETTER' && !['ADMIN', 'MANAGER'].includes(user?.role)) {
        throw ApiError.forbidden('Only admins or managers can upload permission letters')
      }
      const building = await buildingRepository.findById(buildingId)
      if (!building) throw ApiError.notFound('Building not found')
      assertOwnedUrl(url)

      const photo = await buildingRepository.createPhoto({ buildingId, type, url })
      if (type === 'PERMISSION_LETTER') {
        await buildingRepository.upsertPermissionDocument(buildingId, url)
      }
      return photo
    },

    async removePhoto(buildingId, photoId) {
      const photo = await buildingRepository.findPhotoById(photoId)
      if (!photo || photo.buildingId !== buildingId) throw ApiError.notFound('Photo not found')

      await buildingRepository.deletePhoto(photoId)
      if (photo.type === 'PERMISSION_LETTER') {
        await buildingRepository.clearPermissionDocument(buildingId, photo.url)
      }

      // File removal is best-effort — the record is gone either way.
      const key = storage?.keyFromUrl(photo.url)
      if (key) {
        try {
          await storage.delete({ key })
        } catch (err) {
          console.error('File deletion failed (row removed):', err.message)
        }
      }
    },
  }
}
