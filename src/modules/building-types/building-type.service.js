import { ApiError } from '../../lib/api-error.js'

export function createBuildingTypeService({ buildingTypeRepository }) {
  return {
    async createType({ name }) {
      const existing = await buildingTypeRepository.findByName(name)
      if (existing) throw ApiError.conflict('A building type with this name already exists')
      return buildingTypeRepository.create({ name })
    },

    async renameType(id, { name }) {
      const type = await buildingTypeRepository.findById(id)
      if (!type) throw ApiError.notFound('Building type not found')
      return buildingTypeRepository.update(id, { name })
    },

    // Existing buildings keep their stored type string — deletion only
    // removes the option from future forms.
    async deleteType(id) {
      const type = await buildingTypeRepository.findById(id)
      if (!type) throw ApiError.notFound('Building type not found')
      await buildingTypeRepository.delete(id)
    },
  }
}
