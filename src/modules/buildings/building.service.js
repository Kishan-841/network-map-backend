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

  /**
   * Edits echo back the signed URLs we served. Store the canonical form so a
   * row never holds a link that expires.
   */
  const canonical = (url) => (storage?.canonicalUrl && url ? storage.canonicalUrl(url) : url)

  /**
   * Stored URLs are the object's identity, not a readable link — the bucket is
   * private. Swap them for short-lived signed links on the way out, so nothing
   * that leaves this service can be opened by anyone who merely has the URL.
   * Applied only where photos are actually included (list rows carry none).
   */
  const signOne = async (url) => (storage?.readUrl && url ? storage.readUrl(url) : url)

  async function signUrls(building) {
    if (!building || !storage?.readUrl) return building
    const [photos, documentUrl] = await Promise.all([
      building.photos
        ? Promise.all(
            building.photos.map(async (photo) => ({
              ...photo,
              url: await signOne(photo.url),
            })),
          )
        : building.photos,
      signOne(building.permission?.documentUrl),
    ])
    return {
      ...building,
      ...(photos ? { photos } : {}),
      ...(building.permission ? { permission: { ...building.permission, documentUrl } } : {}),
    }
  }

  /**
   * THE read rule for a single building — every endpoint that hands one back
   * must go through this, or roles drift apart per endpoint (they did: /nearby
   * and the photo routes each carried their own half-rule).
   *
   * Resolves the actor's scope once and answers synchronously, so /nearby can
   * check a whole candidate list without a query per building. Fails closed:
   * an unrecognised role sees nothing.
   */
  async function readScope(actor) {
    const assignedZoneIds =
      actor?.role === 'SURVEYOR' ? await userRepository.assignedZoneIds(actor.id) : []
    return (building) => {
      switch (actor?.role) {
        case 'ADMIN':
        case 'MANAGER':
          return true
        case 'SURVEYOR':
          return building.createdById === actor.id || assignedZoneIds.includes(building.zoneId)
        case 'ACQUISITION_AGENT':
          return building.createdById === actor.id
        case 'ACQUISITION_LEAD':
          return building.source === 'ACQUISITION'
        default:
          return false
      }
    }
  }

  /**
   * Writing to a building (photos) is stricter than reading it: field roles
   * may only touch what they logged themselves, even inside a zone they can
   * otherwise read.
   */
  async function assertMayModify(building, actor) {
    if (['SURVEYOR', 'ACQUISITION_AGENT'].includes(actor?.role)) {
      if (building.createdById !== actor.id) {
        throw ApiError.forbidden('You can only change photos on your own buildings')
      }
      return
    }
    const canRead = await readScope(actor)
    if (!canRead(building)) throw ApiError.forbidden('You cannot change this building')
  }

  return {
    async createBuilding(input, createdById, actor) {
      // eslint-disable-next-line prefer-const -- photos is normalised below
      let { details, permission, photos, contact, ...building } = input
      photos?.forEach((photo) => assertOwnedUrl(photo.url))
      if (permission?.documentUrl) assertOwnedUrl(permission.documentUrl)
      photos = photos?.map((photo) => ({ ...photo, url: canonical(photo.url) }))
      if (permission?.documentUrl) permission.documentUrl = canonical(permission.documentUrl)

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
        const created = await buildingRepository.create({
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
        return signUrls(created)
      }
      if (contact) {
        throw ApiError.badRequest('Contact details are only captured by acquisition agents')
      }
      // Everything below this line writes a COVERAGE building. Leads run the
      // acquisition team and can't even read the coverage registry, so they
      // must not be able to silently write into it.
      if (actor?.role === 'ACQUISITION_LEAD') {
        throw ApiError.forbidden('Acquisition leads cannot add coverage buildings')
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
      const created = await buildingRepository.create({
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
      return signUrls(created)
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
      // Acquisition buildings carry cityId directly; coverage buildings reach
      // their city through zone → operator.
      if (cityId) {
        if (where.source === 'ACQUISITION') where.cityId = cityId
        else where.zone = { ...where.zone, operator: { cityId } }
      }
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
      const canRead = await readScope(actor)
      if (!canRead(building)) throw ApiError.notFound('Building not found')
      return signUrls(building)
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
      return signUrls(await buildingRepository.update(id, data))
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

      const canRead = await readScope(actor)

      return withinRadius
        .map((building) => {
          // Duplicate signals are computed from the real record first.
          const samePlaceId = Boolean(placeId) && building.placeId === placeId
          const similarName = name ? isSimilarName(name, building.buildingName) : false
          // Anyone who could not open this building must not learn ANYTHING
          // about it beyond "one exists here" — only distance + duplicate
          // signals, never name / address / coordinates / details / owner.
          // /nearby is unauthenticated-by-scope otherwise: a caller could walk
          // a grid of radius queries and rebuild the whole registry.
          if (!canRead(building)) {
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
      await assertMayModify(building, user)
      // A building has exactly one entrance photo and one permission letter;
      // only ADDITIONAL photos are unlimited. Delete the existing one to replace.
      if (type !== 'ADDITIONAL' && building.photos?.some((photo) => photo.type === type)) {
        const label = type === 'ENTRANCE' ? 'An entrance photo' : 'A permission letter'
        throw ApiError.conflict(`${label} already exists — delete it first to replace it`)
      }
      assertOwnedUrl(url)
      const storedUrl = canonical(url)

      const photo = await buildingRepository.createPhoto({ buildingId, type, url: storedUrl })
      if (type === 'PERMISSION_LETTER') {
        await buildingRepository.upsertPermissionDocument(buildingId, storedUrl)
      }
      return { ...photo, url: await signOne(photo.url) }
    },

    async removePhoto(buildingId, photoId, user) {
      const photo = await buildingRepository.findPhotoById(photoId)
      if (!photo || photo.buildingId !== buildingId) throw ApiError.notFound('Photo not found')

      // Field roles may manage photos on their OWN buildings (so they can fix a
      // wrong entrance/selfie upload); admins/managers may manage any. Without
      // this the delete also destroys the file in object storage.
      const building = await buildingRepository.findById(buildingId)
      if (!building) throw ApiError.notFound('Photo not found')
      await assertMayModify(building, user)

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
