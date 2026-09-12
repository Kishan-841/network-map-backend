import { ApiError } from '../../lib/api-error.js'
import { prisma } from '../../lib/prisma.js'
import { closureRepository } from './closure.repository.js'
import { fiberPointRepository } from '../fibers/fiber.repository.js'
import { RATIO_PORTS } from './closure.schemas.js'
import { nextClosureCode } from '../../lib/sequences.js'

export function createClosureService({ closureRepository, fiberPointRepository, sequences, prisma }) {
  async function mustFind(id) {
    const closure = await closureRepository.findById(id)
    if (!closure) throw ApiError.notFound('Closure not found')
    return closure
  }
  async function mustFindSplitter(id) {
    const splitter = await closureRepository.findSplitterById(id)
    if (!splitter) throw ApiError.notFound('Splitter not found')
    return splitter
  }

  return {
    listClosures: () => closureRepository.list(),

    async getClosure(id) {
      const closure = await mustFind(id)
      const through = await closureRepository.fibersThrough(id)
      const fibers = through.map(({ fiber, pointSeq, maxSeq }) => ({
        ...fiber,
        role: pointSeq === maxSeq ? 'in' : pointSeq === 0 ? 'out' : 'through',
      }))
      return { ...closure, fibers }
    },

    createClosure: (data) =>
      prisma.$transaction(async (tx) =>
        closureRepository.create({ ...data, code: await sequences.nextClosureCode(tx) }, tx),
      ),

    async updateClosure(id, data) {
      await mustFind(id)
      const closure = await closureRepository.update(id, data)
      if (data.latitude != null && data.longitude != null) {
        await fiberPointRepository.updatePositionForClosure(id, {
          latitude: data.latitude,
          longitude: data.longitude,
        })
        await fiberPointRepository.recomputeSegmentsTouching({ closureId: id })
      }
      return closure
    },

    async deleteClosure(id) {
      const closure = await mustFind(id)
      if (closure._count.points > 0) {
        throw ApiError.conflict('Fibers pass through this closure — retype those points first')
      }
      await closureRepository.delete(id)
    },

    async addSplitter(closureId, data) {
      await mustFind(closureId)
      let inputFiberId = data.inputFiberId ?? null
      if (!inputFiberId) {
        const ending = await closureRepository.fibersEndingAt(closureId)
        if (ending.length === 1) inputFiberId = ending[0].id
      }
      return closureRepository.createSplitter(
        { closureId, ratio: data.ratio, location: data.location, inputFiberId },
        RATIO_PORTS[data.ratio],
      )
    },

    async updateSplitter(id, data) {
      const splitter = await mustFindSplitter(id)
      if (data.ratio) {
        const used = Math.max(
          0,
          ...splitter.outputs.filter((o) => o.toFiberId || o.toBuildingId).map((o) => o.portNo),
        )
        if (RATIO_PORTS[data.ratio] < used) {
          throw ApiError.conflict(`Output ${used} is in use — cannot reduce the ratio`)
        }
      }
      return closureRepository.updateSplitter(id, data, data.ratio ? RATIO_PORTS[data.ratio] : null)
    },

    async deleteSplitter(id) {
      const splitter = await mustFindSplitter(id)
      if (splitter.outputs.some((o) => o.toFiberId)) {
        throw ApiError.conflict('An output still feeds a fiber')
      }
      await closureRepository.deleteSplitter(id)
    },

    async setOutput(splitterId, portNo, data) {
      const splitter = await closureRepository.findSplitterById(splitterId)
      if (!splitter || !splitter.outputs.some((o) => o.portNo === portNo)) {
        throw ApiError.notFound('Output not found')
      }
      return closureRepository.updateOutput(splitterId, portNo, data)
    },
  }
}

export const closureService = createClosureService({
  closureRepository,
  fiberPointRepository,
  sequences: { nextClosureCode },
  prisma,
})
