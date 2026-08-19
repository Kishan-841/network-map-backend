import { ApiError } from '../../lib/api-error.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { fiberRouteRepository } from './fiber-route.repository.js'

export function createFiberRouteService(deps) {
  const { fiberRouteRepository, storage } = deps

  async function assertNameFree(name, selfId) {
    const clash = await fiberRouteRepository.findByName(name)
    if (clash && clash.id !== selfId) {
      throw ApiError.conflict('A fiber route with this name already exists')
    }
  }

  // Stored URLs are rendered as <img src> — only accept files that came from
  // our own uploads API (blocks javascript:/foreign URLs), like buildings do.
  function assertOwnedImages(images) {
    for (const url of images ?? []) {
      if (!storage?.keyFromUrl(url)) {
        throw ApiError.badRequest('Image URL must come from the uploads API')
      }
    }
  }

  return {
    async listFiberRoutes() {
      return fiberRouteRepository.list()
    },

    async createFiberRoute(data) {
      await assertNameFree(data.name)
      assertOwnedImages(data.images)
      return fiberRouteRepository.create(data)
    },

    async updateFiberRoute(id, data) {
      const route = await fiberRouteRepository.findById(id)
      if (!route) throw ApiError.notFound('Fiber route not found')
      if (data.name) await assertNameFree(data.name, id)
      assertOwnedImages(data.images)
      return fiberRouteRepository.update(id, data)
    },

    async deleteFiberRoute(id) {
      const route = await fiberRouteRepository.findById(id)
      if (!route) throw ApiError.notFound('Fiber route not found')
      await fiberRouteRepository.delete(id)
    },
  }
}

export const fiberRouteService = createFiberRouteService({
  fiberRouteRepository,
  storage: getStorageProvider(),
})
