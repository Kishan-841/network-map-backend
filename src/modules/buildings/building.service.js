import { ApiError } from '../../lib/api-error.js'
import { haversineMeters, boundingBox } from '../../lib/geo.js'
import { isSimilarName } from '../../lib/name-similarity.js'

export function createBuildingService({ buildingRepository, storage, userRepository, zoneRepository }) {
  // Stored URLs are rendered as <a href>/<img src> — only accept files that
  // came from our own uploads API (blocks javascript:/foreign URLs).
  function assertOwnedUrl(url) {
    if (!storage?.keyFromUrl(url)) {
      throw ApiError.badRequest('File URL must come from the uploads API')
    }
  }

  return {
    async createBuilding(input, createdById, actor) {
      const { details, permission, photos, ...building } = input
      photos?.forEach((photo) => assertOwnedUrl(photo.url))
      if (permission?.documentUrl) assertOwnedUrl(permission.documentUrl)
      // Permission records are legal artifacts — surveyors may not set them, the
      // same rule addPhoto enforces for permission letters.
      if (actor?.role === 'SURVEYOR') {
        if (permission) {
          throw ApiError.forbidden('Only admins or managers can set permission details')
        }
        if (photos?.some((photo) => photo.type === 'PERMISSION_LETTER')) {
          throw ApiError.forbidden('Only admins or managers can upload permission letters')
        }
        const assigned = await userRepository.assignedZoneIds(actor.id)
        if (!assigned.includes(building.zoneId)) {
          throw ApiError.forbidden('You are not assigned to this zone')
        }
      }
      return buildingRepository.create({
        ...building,
        createdById,
        // A surveyor adding a building means: surveyed, and viable for fiber
        // (user decision — ease of use over a manual status step).
        feasibleStatus: 'FEASIBLE',
        surveyStatus: 'COMPLETED',
        isLive: building.isLive ?? false, // green when live, red when not
        details: details ? { create: details } : undefined,
        permission: permission ? { create: permission } : undefined,
        photos: photos?.length ? { create: photos } : undefined,
      })
    },

    async listBuildings(filters = {}, actor) {
      const {
        zoneId,
        operatorId,
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
      // Building → Operator is derived through the zone.
      if (operatorId) where.zone = { operatorId }
      if (status) where.feasibleStatus = status
      if (createdById) where.createdById = createdById
      // Surveyors see their assigned zones plus their own buildings — via AND
      // because `search` below owns the top-level OR (spec 2026-08-14).
      if (actor?.role === 'SURVEYOR') {
        const assigned = await userRepository.assignedZoneIds(actor.id)
        where.AND = [{ OR: [{ zoneId: { in: assigned } }, { createdById: actor.id }] }]
      }
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

    async getBuilding(id, actor) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')
      // 404 (not 403) for out-of-scope buildings: don't leak existence.
      if (actor?.role === 'SURVEYOR' && building.createdById !== actor.id) {
        const assigned = await userRepository.assignedZoneIds(actor.id)
        if (!assigned.includes(building.zoneId)) throw ApiError.notFound('Building not found')
      }
      return building
    },

    async updateBuilding(id, { details, permission, ...building }) {
      const existing = await buildingRepository.findById(id)
      if (!existing) throw ApiError.notFound('Building not found')
      if (building.zoneId && building.zoneId !== existing.zoneId) {
        const zone = await zoneRepository.findById(building.zoneId)
        if (!zone) throw ApiError.badRequest('Zone does not exist')
      }
      const data = { ...building }
      // Older buildings may lack the child rows — upsert instead of update.
      if (details) data.details = { upsert: { create: details, update: details } }
      if (permission) {
        const patch = { ...permission }
        if (patch.permissionDate !== undefined) {
          patch.permissionDate = patch.permissionDate ? new Date(patch.permissionDate) : null
        }
        if (patch.renewalDate !== undefined) {
          patch.renewalDate = patch.renewalDate ? new Date(patch.renewalDate) : null
        }
        data.permission = { upsert: { create: patch, update: patch } }
      }
      return buildingRepository.update(id, data)
    },

    async updateStatus(id, { feasibleStatus, surveyStatus, isLive }) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')
      return buildingRepository.update(id, {
        ...(feasibleStatus && { feasibleStatus }),
        ...(surveyStatus && { surveyStatus }),
        ...(isLive !== undefined && { isLive }),
      })
    },

    async findNearby({ latitude, longitude, radiusMeters, name, placeId }, actor) {
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

      const assigned =
        actor?.role === 'SURVEYOR' ? await userRepository.assignedZoneIds(actor.id) : null

      return withinRadius
        .map((building) => {
          // Duplicate signals are computed from the real record first.
          const samePlaceId = Boolean(placeId) && building.placeId === placeId
          const similarName = name ? isSimilarName(name, building.buildingName) : false
          // A surveyor must not learn ANYTHING about a building outside their
          // assigned zones beyond "one exists here" — return only distance +
          // duplicate signals, never address / coordinates / details / owner.
          if (
            actor?.role === 'SURVEYOR' &&
            building.createdById !== actor.id &&
            !assigned.includes(building.zoneId)
          ) {
            return {
              id: building.id,
              distanceMeters: building.distanceMeters,
              buildingName: null,
              formattedAddress: null,
              samePlaceId,
              similarName,
              masked: true,
            }
          }
          return { ...building, samePlaceId, similarName }
        })
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
    },

    async addPhoto(buildingId, { type, url }, user) {
      // Permission letters feed the legal permission record — surveyors may not set them.
      if (type === 'PERMISSION_LETTER' && !['ADMIN', 'MANAGER'].includes(user?.role)) {
        throw ApiError.forbidden('Only admins or managers can upload permission letters')
      }
      const building = await buildingRepository.findById(buildingId)
      if (!building) throw ApiError.notFound('Building not found')
      if (user?.role === 'SURVEYOR' && building.createdById !== user.id) {
        throw ApiError.forbidden('You can only add photos to your own buildings')
      }
      // A building has exactly one entrance photo and one permission letter;
      // only ADDITIONAL photos are unlimited. Delete the existing one to replace.
      if (type !== 'ADDITIONAL' && building.photos?.some((photo) => photo.type === type)) {
        const label = type === 'ENTRANCE' ? 'An entrance photo' : 'A permission letter'
        throw ApiError.conflict(`${label} already exists — delete it first to replace it`)
      }
      assertOwnedUrl(url)

      const photo = await buildingRepository.createPhoto({ buildingId, type, url })
      if (type === 'PERMISSION_LETTER') {
        await buildingRepository.upsertPermissionDocument(buildingId, url)
      }
      return photo
    },

    async removePhoto(buildingId, photoId, user) {
      const photo = await buildingRepository.findPhotoById(photoId)
      if (!photo || photo.buildingId !== buildingId) throw ApiError.notFound('Photo not found')

      // Surveyors may manage photos on their OWN buildings (so they can fix a
      // wrong entrance/permission upload); admins/managers may manage any.
      if (user?.role === 'SURVEYOR') {
        const building = await buildingRepository.findById(buildingId)
        if (!building || building.createdById !== user.id) {
          throw ApiError.forbidden('You can only delete photos on your own buildings')
        }
      }

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

    async deleteBuilding(id) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')

      // Collect every stored file before the row (and its cascaded photo/
      // permission children) disappears. The permission letter usually exists
      // as both a photo row and permission.documentUrl — the Set dedupes it.
      const urls = new Set(building.photos?.map((photo) => photo.url) ?? [])
      if (building.permission?.documentUrl) urls.add(building.permission.documentUrl)

      await buildingRepository.delete(id)

      // File removal is best-effort — the record is gone either way.
      for (const url of urls) {
        const key = storage?.keyFromUrl(url)
        if (!key) continue
        try {
          await storage.delete({ key })
        } catch (err) {
          console.error('File deletion failed (row removed):', err.message)
        }
      }
    },
  }
}
