import { ApiError } from '../../lib/api-error.js'
import { prisma } from '../../lib/prisma.js'
import { closureRepository } from './closure.repository.js'
import { fiberPointRepository } from '../fibers/fiber.repository.js'
import { RATIO_PORTS } from './closure.schemas.js'
import { nextClosureCode, nextSplitterCode } from '../../lib/sequences.js'
import { canSeeFiber, closureScope, splitterScope } from '../../lib/visibility.js'

export function createClosureService({ closureRepository, fiberPointRepository, sequences, prisma }) {
  // Out of the reader's zones reads exactly like one that does not exist.
  async function mustFind(id, actor) {
    const closure = await closureRepository.findVisible(id, closureScope(actor))
    if (!closure) throw ApiError.notFound('Closure not found')
    return closure
  }
  async function mustFindSplitter(id, actor) {
    const splitter = await closureRepository.findSplitterVisible(id, splitterScope(actor))
    if (!splitter) throw ApiError.notFound('Splitter not found')
    return splitter
  }

  return {
    listClosures: (actor) => closureRepository.list(closureScope(actor)),

    async getClosure(id, actor) {
      const closure = await mustFind(id, actor)
      const through = await closureRepository.fibersThrough(id)
      // Only the cables the reader could open themselves.
      const fibers = through.filter(({ fiber }) => canSeeFiber(actor, fiber)).map(({ fiber, pointSeq, maxSeq }) => ({
        ...fiber,
        role: pointSeq === maxSeq ? 'in' : pointSeq === 0 ? 'out' : 'through',
      }))
      return { ...closure, fibers }
    },

    createClosure: (data, actor) =>
      prisma.$transaction(async (tx) =>
        closureRepository.create(
          { ...data, code: await sequences.nextClosureCode(tx), createdById: actor.id },
          tx,
        ),
      ),

    async updateClosure(id, data, actor) {
      await mustFind(id, actor)
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

    async deleteClosure(id, actor) {
      const closure = await mustFind(id, actor)
      if (closure._count.points > 0) {
        throw ApiError.conflict('Fibers pass through this closure — retype those points first')
      }
      await closureRepository.delete(id)
    },

    async addSplitter(closureId, data, actor) {
      const closure = await mustFind(closureId, actor)
      if (data.inputFiberId && !canSeeFiber(actor, await closureRepository.findFiberOwner(data.inputFiberId))) {
        throw ApiError.badRequest('Fiber does not exist')
      }
      // A splitter may sit on any closure of a line — passing through one is
      // fine. The caller names the fiber that feeds it; when it does not, a
      // lone fiber ending here is the only unambiguous candidate.
      let inputFiberId = data.inputFiberId ?? null
      if (!inputFiberId) {
        const ending = await closureRepository.fibersEndingAt(closureId)
        if (ending.length === 1) inputFiberId = ending[0].id
      }
      // Every splitter carries its own code and position now, whether it hangs
      // off a closure or sits on a line; a closure's takes the closure's.
      return prisma.$transaction(async (tx) =>
        closureRepository.createSplitter(
          {
            code: await sequences.nextSplitterCode(tx),
            latitude: closure.latitude,
            longitude: closure.longitude,
            closureId,
            ratio: data.ratio,
            location: data.location,
            fiberType: data.fiberType ?? null,
            inputFiberId,
            // The closure's owner, so whoever runs that closure sees what hangs off it.
            createdById: closure.createdById,
          },
          RATIO_PORTS[data.ratio],
          tx,
        ),
      )
    },

    async updateSplitter(id, data, actor) {
      const splitter = await mustFindSplitter(id, actor)
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

    async deleteSplitter(id, actor) {
      const splitter = await mustFindSplitter(id, actor)
      if (splitter.outputs.some((o) => o.toFiberId)) {
        throw ApiError.conflict('An output still feeds a fiber')
      }
      // FiberPoint → Splitter is RESTRICT: the point has to become a plain bend
      // first, or Postgres would answer with a 500 instead of this.
      if (splitter._count?.points > 0) {
        throw ApiError.conflict('Remove the splitter from its fiber first')
      }
      await closureRepository.deleteSplitter(id)
    },

    async setOutput(splitterId, portNo, data, actor) {
      const splitter = await closureRepository.findSplitterVisible(splitterId, splitterScope(actor))
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
  sequences: { nextClosureCode, nextSplitterCode },
  prisma,
})
