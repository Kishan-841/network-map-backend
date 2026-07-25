import { ApiError } from '../../lib/api-error.js'

export function createZoneService({ zoneRepository }) {
  return {
    async createZone({ name, city, boundary }) {
      const existing = await zoneRepository.findByName(name)
      if (existing) throw ApiError.conflict('A zone with this name already exists')
      return zoneRepository.create({ name, city, ...(boundary && { boundary }) })
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
