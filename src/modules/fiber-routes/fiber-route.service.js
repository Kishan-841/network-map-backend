import { ApiError } from '../../lib/api-error.js'
import { fiberRouteRepository } from './fiber-route.repository.js'

export function createFiberRouteService(deps) {
  const { fiberRouteRepository } = deps

  async function assertNameFree(name, selfId) {
    const clash = await fiberRouteRepository.findByName(name)
    if (clash && clash.id !== selfId) {
      throw ApiError.conflict('A fiber route with this name already exists')
    }
  }

  return {
    async listFiberRoutes() {
      return fiberRouteRepository.list()
    },

    async createFiberRoute(data) {
      await assertNameFree(data.name)
      return fiberRouteRepository.create(data)
    },

    async updateFiberRoute(id, data) {
      const route = await fiberRouteRepository.findById(id)
      if (!route) throw ApiError.notFound('Fiber route not found')
      if (data.name) await assertNameFree(data.name, id)
      return fiberRouteRepository.update(id, data)
    },

    async deleteFiberRoute(id) {
      const route = await fiberRouteRepository.findById(id)
      if (!route) throw ApiError.notFound('Fiber route not found')
      await fiberRouteRepository.delete(id)
    },
  }
}

export const fiberRouteService = createFiberRouteService({ fiberRouteRepository })
