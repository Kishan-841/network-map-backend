import { Prisma } from '@prisma/client'
import { ApiError } from '../../lib/api-error.js'

// Roles that see only the zones they were given.
const ASSIGNED_ZONES_ONLY = ['SURVEYOR', 'TEAM_LEADER', 'MANAGER']

export function createZoneService({ zoneRepository }) {
  return {
    async listZones(actor) {
      // Surveyors, team leaders and managers see the zones they were given; others all.
      if (ASSIGNED_ZONES_ONLY.includes(actor?.role)) return zoneRepository.listAssigned(actor.id)
      return zoneRepository.list()
    },

    async listZonesPaged({ page, pageSize, search }, actor) {
      const where = {
        ...(ASSIGNED_ZONES_ONLY.includes(actor?.role) && { assignedUsers: { some: { id: actor.id } } }),
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
      // Prisma needs DbNull (not JS null) to clear a Json? column to SQL NULL.
      const patch =
        data.boundary === null ? { ...data, boundary: Prisma.DbNull } : data
      return zoneRepository.update(id, patch)
    },

    async deleteZone(id) {
      const zone = await zoneRepository.findById(id)
      if (!zone) throw ApiError.notFound('Zone not found')

      const buildingCount = await zoneRepository.countBuildings(id)
      if (buildingCount > 0) {
        const societies = await zoneRepository.countPermissionBuildings(id)
        throw ApiError.conflict(
          `Cannot delete: ${buildingCount} building(s) are assigned to this zone` +
            (societies > 0
              ? ` (including ${societies} society-permission building(s), which the Buildings tab does not show)`
              : ''),
        )
      }
      await zoneRepository.delete(id)
    },
  }
}
