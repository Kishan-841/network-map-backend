import { ApiError } from '../../lib/api-error.js'
import { cityRepository } from './city.repository.js'

export function createCityService(deps) {
  const { cityRepository } = deps

  return {
    async listCities() {
      return cityRepository.list()
    },

    async createCity({ name }) {
      const existing = await cityRepository.findByName(name)
      if (existing) throw ApiError.conflict('A city with this name already exists')
      return cityRepository.create({ name })
    },

    async updateCity(id, data) {
      const city = await cityRepository.findById(id)
      if (!city) throw ApiError.notFound('City not found')
      if (data.name) {
        const clash = await cityRepository.findByName(data.name)
        if (clash && clash.id !== id) throw ApiError.conflict('A city with this name already exists')
      }
      return cityRepository.update(id, data)
    },

    async deleteCity(id) {
      const city = await cityRepository.findById(id)
      if (!city) throw ApiError.notFound('City not found')
      // Operators keep existing — the FK SetNull detaches them.
      await cityRepository.delete(id)
    },
  }
}

export const cityService = createCityService({ cityRepository })
