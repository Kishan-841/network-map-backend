import { ApiError } from '../../lib/api-error.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { fiberRouteRepository } from './fiber-route.repository.js'
import { operatorRepository } from '../operators/operator.repository.js'

export function createFiberRouteService(deps) {
  const { fiberRouteRepository, storage, operatorRepository } = deps

  async function assertOperatorExists(operatorId) {
    if (!operatorId) return
    const operator = await operatorRepository.findById(operatorId)
    if (!operator) throw ApiError.badRequest('Operator does not exist')
  }

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

  /** Edits echo back the signed URLs we served — store the canonical form. */
  function canonicalImages(data) {
    if (!data.images || !storage?.canonicalUrl) return data
    return { ...data, images: data.images.map((url) => storage.canonicalUrl(url)) }
  }

  /**
   * Same rule as building photos: the stored URL is the object's identity, the
   * link handed to a browser is short-lived and signed.
   */
  async function signImages(route) {
    if (!route?.images?.length || !storage?.readUrl) return route
    return { ...route, images: await Promise.all(route.images.map((u) => storage.readUrl(u))) }
  }

  return {
    async listFiberRoutes() {
      const routes = await fiberRouteRepository.list()
      return Promise.all(routes.map(signImages))
    },

    async createFiberRoute(data) {
      await assertNameFree(data.name)
      await assertOperatorExists(data.operatorId)
      assertOwnedImages(data.images)
      return signImages(await fiberRouteRepository.create(canonicalImages(data)))
    },

    async updateFiberRoute(id, data) {
      const route = await fiberRouteRepository.findById(id)
      if (!route) throw ApiError.notFound('Fiber route not found')
      if (data.name) await assertNameFree(data.name, id)
      await assertOperatorExists(data.operatorId)
      assertOwnedImages(data.images)
      return signImages(await fiberRouteRepository.update(id, canonicalImages(data)))
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
  operatorRepository,
})
