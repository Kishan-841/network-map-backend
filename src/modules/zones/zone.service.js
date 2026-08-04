import { ApiError } from '../../lib/api-error.js'

export function createZoneService({ zoneRepository }) {
  return {
    async listZones(actor) {
      if (actor?.role === 'SURVEYOR') return zoneRepository.listAssigned(actor.id)
      return zoneRepository.list()
    },

    async listZonesPaged({ page, pageSize, search }, actor) {
      const where = {
        ...(actor?.role === 'SURVEYOR' && { assignedUsers: { some: { id: actor.id } } }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
          ],
        }),
      }
      const [items, total] = await Promise.all([
        zoneRepository.paged({ where, skip: (page - 1) * pageSize, take: pageSize }),
        zoneRepository.count(where),
      ])
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    },

    async createZone({ name, city, boundary }) {
      const existing = await zoneRepository.findByName(name)
      if (existing) throw ApiError.conflict('A zone with this name already exists')
      return zoneRepository.create({ name, city, ...(boundary && { boundary }) })
    },

    // Sequential create-or-skip; re-uploading the same file is idempotent.
    async bulkCreateZones(rows) {
      const created = []
      const skipped = []
      const seenNames = new Set()
      for (const { name, city } of rows) {
        if (seenNames.has(name)) {
          skipped.push({ name, reason: 'duplicate in file' })
          continue
        }
        seenNames.add(name)
        const existing = await zoneRepository.findByName(name)
        if (existing) {
          skipped.push({ name, reason: 'already exists' })
          continue
        }
        created.push(await zoneRepository.create({ name, city }))
      }
      return { created, skipped, total: rows.length }
    },

    async updateZone(id, data) {
      const zone = await zoneRepository.findById(id)
      if (!zone) throw ApiError.notFound('Zone not found')
      return zoneRepository.update(id, data)
    },

    async deleteZone(id) {
      const zone = await zoneRepository.findById(id)
      if (!zone) throw ApiError.notFound('Zone not found')

      const buildingCount = await zoneRepository.countBuildings(id)
      if (buildingCount > 0) {
        throw ApiError.conflict(
          `Cannot delete: ${buildingCount} building(s) are assigned to this zone`,
        )
      }
      await zoneRepository.delete(id)
    },
  }
}
