import { ApiError } from '../../lib/api-error.js'
import { popRepository } from './pop.repository.js'
import { fiberPointRepository } from '../fibers/fiber.repository.js'

export function createPopService({ popRepository, fiberPointRepository }) {
  async function mustFind(id) {
    const pop = await popRepository.findById(id)
    if (!pop) throw ApiError.notFound('POP not found')
    return pop
  }
  async function assertNameFree(name, selfId) {
    const clash = await popRepository.findByName(name)
    if (clash && clash.id !== selfId) throw ApiError.conflict('A POP with this name already exists')
  }
  async function mustFindOlt(popId, oltId) {
    const olt = await popRepository.findOltById(oltId)
    if (!olt || olt.popId !== popId) throw ApiError.notFound('OLT not found')
    return olt
  }
  return {
    listPops: () => popRepository.list(),
    async createPop(data) {
      await assertNameFree(data.name)
      return popRepository.create(data)
    },
    async updatePop(id, data) {
      await mustFind(id)
      if (data.name) await assertNameFree(data.name, id)
      const pop = await popRepository.update(id, data)
      // A POP's position is the truth for every fiber point that sits on it (spec §2.8).
      if (data.latitude != null && data.longitude != null) {
        await fiberPointRepository.updatePositionForPop(id, {
          latitude: data.latitude,
          longitude: data.longitude,
        })
      }
      return pop
    },
    async deletePop(id) {
      await mustFind(id)
      if ((await popRepository.countPointsForPop(id)) > 0) {
        throw ApiError.conflict('Fibers still start at this POP — retype or delete them first')
      }
      await popRepository.delete(id)
    },
    async createOlt(popId, data) {
      await mustFind(popId)
      const clash = await popRepository.findOltByName(popId, data.name)
      if (clash) throw ApiError.conflict('An OLT with this name already exists at this POP')
      return popRepository.createOlt({ ...data, popId })
    },
    async updateOlt(popId, oltId, data) {
      await mustFindOlt(popId, oltId)
      if (data.ponPortCount != null) {
        const used = await popRepository.maxUsedPort(oltId)
        if (data.ponPortCount < used) {
          throw ApiError.conflict(`Port ${used} is in use — cannot reduce below it`)
        }
      }
      return popRepository.updateOlt(oltId, data)
    },
    async deleteOlt(popId, oltId) {
      await mustFindOlt(popId, oltId)
      if ((await popRepository.countFibersForOlt(oltId)) > 0) {
        throw ApiError.conflict('Fibers are assigned to this OLT')
      }
      await popRepository.deleteOlt(oltId)
    },
  }
}

export const popService = createPopService({ popRepository, fiberPointRepository })
