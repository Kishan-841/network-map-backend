import { ApiError } from '../../lib/api-error.js'
import { haversineMeters, boundingBox } from '../../lib/geo.js'
import { isSimilarName } from '../../lib/name-similarity.js'

export function createBuildingService({ buildingRepository, storage, userRepository, zoneRepository, operatorRepository }) {
  // Stored URLs are rendered as <a href>/<img src> — only accept files that
  // came from our own uploads API (blocks javascript:/foreign URLs).
  function assertOwnedUrl(url) {
    if (!storage?.keyFromUrl(url)) {
      throw ApiError.badRequest('File URL must come from the uploads API')
    }
  }

  return {
    async createBuilding(input, createdById, actor) {
      const { details, permission, photos, contact, ...building } = input
      photos?.forEach((photo) => assertOwnedUrl(photo.url))
      if (permission?.documentUrl) assertOwnedUrl(permission.documentUrl)

      // --- Acquisition agents: contact person + proof photos are mandatory,
      // territory comes from their pincode assignment (never the client).
      if (actor?.role === 'ACQUISITION_AGENT') {
        if (!contact) throw ApiError.badRequest('Contact person details are required')
        const hasType = (type) => photos?.some((photo) => photo.type === type)
        if (!hasType('SELFIE')) throw ApiError.badRequest('A selfie photo is required')
        if (!hasType('CONTACT_PERSON')) {
          throw ApiError.badRequest('A photo of the contact person is required')
        }
        const assigned = await userRepository.assignedPincodes(actor.id)
        if (assigned.length === 0) {
          throw ApiError.forbidden('No pincodes are assigned to you yet')
        }
        const match = assigned.find((a) => a.pincode === building.pincode)
        if (!match) throw ApiError.forbidden('That pincode is not assigned to you')
        return buildingRepository.create({
          ...building,
          pincode: match.pincode,
          cityId: match.cityId,
          zoneId: null, // acquisition buildings live outside coverage zones
          source: 'ACQUISITION',
          createdById,
          feasibleStatus: 'SURVEY_PENDING',
          surveyStatus: 'COMPLETED',
          isLive: false,
          details: details ? { create: details } : undefined,
          contact: { create: contact },
          photos: photos?.length ? { create: photos } : undefined,
        })
      }
      if (contact) {
        throw ApiError.badRequest('Contact details are only captured by acquisition agents')
      }
      if (!building.zoneId) throw ApiError.badRequest('Zone is required')
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
        source,
        pincode,
        zoneId,
        operatorId,
        cityId,
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
      // --- Acquisition visibility: agents see ONLY their own rows; leads see
      // the whole acquisition registry and never the coverage one.
      if (actor?.role === 'ACQUISITION_AGENT') {
        where.createdById = actor.id
        where.source = 'ACQUISITION'
      } else if (actor?.role === 'ACQUISITION_LEAD') {
        where.source = 'ACQUISITION'
        if (createdById) where.createdById = createdById
      } else if (source) {
        where.source = source
      }
      if (pincode) where.pincode = pincode
      if (zoneId) where.zoneId = zoneId
      // Building → Operator → City are derived through the zone.
      if (operatorId) where.zone = { operatorId }
      if (cityId) where.zone = { ...where.zone, operator: { cityId } }
      if (status) where.feasibleStatus = status
      if (createdById && !where.createdById) where.createdById = createdById
      // The coverage registry (map, buildings list) excludes acquisition rows
      // unless explicitly asked for.
      if (!where.source && ['ADMIN', 'MANAGER', 'SURVEYOR'].includes(actor?.role)) {
        where.source = 'COVERAGE'
      }
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
      if (actor?.role === 'ACQUISITION_AGENT' && building.createdById !== actor.id) {
        throw ApiError.notFound('Building not found')
      }
      if (actor?.role === 'ACQUISITION_LEAD' && building.source !== 'ACQUISITION') {
        throw ApiError.notFound('Building not found')
      }
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
          // Acquisition agents may only ever learn "something exists here".
          const maskForAgent =
            actor?.role === 'ACQUISITION_AGENT' && building.createdById !== actor.id
          if (
            maskForAgent ||
            (actor?.role === 'SURVEYOR' &&
              building.createdById !== actor.id &&
              !assigned.includes(building.zoneId))
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

    /**
     * Admin bulk import: create-or-skip per row so re-uploading the same
     * sheet is idempotent. Missing zones/operators are created on the fly
     * (zone city defaults to 'Unknown' — editable later), mirroring the
     * operator-mapping import. Rich fields (floors, wings, …) arrive later
     * via the normal Update building flow.
     */
    async bulkCreateBuildings(rows, createdById) {
      const zonesByName = new Map(
        (await zoneRepository.listAll()).map((zone) => [zone.name.trim().toLowerCase(), zone]),
      )
      const operatorsByName = new Map(
        (await operatorRepository.listAll()).map((op) => [op.name.trim().toLowerCase(), op]),
      )
      const created = []
      const skipped = []
      let zonesCreated = 0
      let operatorsCreated = 0
      const seenInFile = new Set()

      for (const [index, row] of rows.entries()) {
        const rowNo = index + 1
        // 1. Operator (optional) — reuse or create.
        let operatorId = null
        const operatorName = row.operator?.trim()
        if (operatorName) {
          const key = operatorName.toLowerCase()
          let operator = operatorsByName.get(key)
          if (!operator) {
            operator = await operatorRepository.create({ name: operatorName })
            operatorsByName.set(key, operator)
            operatorsCreated++
          }
          operatorId = operator.id
        }

        // 2. Zone — reuse or create; link a fresh/unlinked zone to the operator.
        const zoneKey = row.zone.trim().toLowerCase()
        let zone = zonesByName.get(zoneKey)
        if (!zone) {
          zone = await zoneRepository.create({
            name: row.zone.trim(),
            city: 'Unknown',
            ...(operatorId && { operatorId }),
          })
          zonesByName.set(zoneKey, zone)
          zonesCreated++
        } else if (operatorId && !zone.operatorId) {
          zone = await zoneRepository.update(zone.id, { operatorId })
          zonesByName.set(zoneKey, zone)
        }

        // 3. Building — skip duplicates (same name in the same zone).
        const dupKey = `${zoneKey}|${row.buildingName.trim().toLowerCase()}`
        if (seenInFile.has(dupKey)) {
          skipped.push({ row: rowNo, buildingName: row.buildingName, reason: 'duplicate in file' })
          continue
        }
        seenInFile.add(dupKey)
        const existing = await buildingRepository.findByNameInZone(row.buildingName.trim(), zone.id)
        if (existing) {
          skipped.push({ row: rowNo, buildingName: row.buildingName, reason: 'already exists in zone' })
          continue
        }

        const hasDetails = row.homePass != null || row.remark
        const building = await buildingRepository.create({
          buildingName: row.buildingName.trim(),
          formattedAddress: row.buildingName.trim(),
          latitude: row.latitude,
          longitude: row.longitude,
          zoneId: zone.id,
          createdById,
          feasibleStatus: 'FEASIBLE',
          surveyStatus: 'COMPLETED',
          isLive: false,
          ...(hasDetails && {
            details: {
              create: {
                ...(row.homePass != null && { homePass: row.homePass }),
                ...(row.remark && { remarks: row.remark }),
              },
            },
          }),
        })
        created.push(building.id)
      }

      return {
        createdCount: created.length,
        skipped,
        zonesCreated,
        operatorsCreated,
        total: rows.length,
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
