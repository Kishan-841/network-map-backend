import { Prisma } from '@prisma/client'
import { ApiError } from '../../lib/api-error.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { prisma } from '../../lib/prisma.js'
import { closureRepository } from './closure.repository.js'
import { fiberPointRepository } from '../fibers/fiber.repository.js'
import { RATIO_PORTS } from './closure.schemas.js'
import { withCableWrites } from './closure-cables.js'
import { nextClosureCode, nextSplitterCode } from '../../lib/sequences.js'
import { canSeeFiber, closureScope, splitterScope } from '../../lib/visibility.js'
import { isVisibleBuilding } from '../../lib/building-source.js'
import { createBuildingService } from '../buildings/building.service.js'
import { buildingRepository } from '../buildings/building.repository.js'
import { userRepository } from '../users/user.repository.js'
import { zoneRepository } from '../zones/zone.repository.js'
import { operatorRepository } from '../operators/operator.repository.js'

// The Buildings module's read rule, for "may this user put a splitter in that building?".
const buildingReader = createBuildingService({
  buildingRepository,
  storage: getStorageProvider(),
  userRepository,
  zoneRepository,
  operatorRepository,
})

export function createClosureService({ closureRepository, fiberPointRepository, sequences, prisma, storage }) {
  /**
   * Closure photos follow the fibre/POP rule: only our own uploads may be
   * stored, the stored URL is the object's identity (canonical), and the link
   * handed to a browser is short-lived and signed.
   */
  function assertOwnedImages(images) {
    for (const url of images ?? []) {
      if (!storage?.keyFromUrl(url)) {
        throw ApiError.badRequest('Image URL must come from the uploads API')
      }
    }
  }
  function canonicalImages(data) {
    // Prisma needs DbNull (not JS null) to clear a Json? column to SQL NULL.
    if (data.images === null) return { ...data, images: Prisma.DbNull }
    if (!data.images || !storage?.canonicalUrl) return data
    return { ...data, images: data.images.map((url) => storage.canonicalUrl(url)) }
  }
  async function signImages(closure) {
    if (!closure?.images?.length || !storage?.readUrl) return closure
    return { ...closure, images: await Promise.all(closure.images.map((u) => storage.readUrl(u))) }
  }

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

  // A fiber the reader could not open is left out, exactly as a closure's
  // "fibers through" does; only what the screens need is kept.
  const visibleFiber = (actor, fiber) =>
    fiber && canSeeFiber(actor, fiber) ? { id: fiber.id, name: fiber.name, status: fiber.status } : null

  // What a splitter row says wherever it is listed or opened.
  function splitterSummary(s, actor) {
    const onFiber = s.points.map((p) => visibleFiber(actor, p.fiber)).find(Boolean) ?? null
    return {
      id: s.id,
      code: s.code,
      ratio: s.ratio,
      location: s.location,
      fiberType: s.fiberType,
      latitude: s.latitude,
      longitude: s.longitude,
      createdAt: s.createdAt,
      closure: s.closure,
      building: s.building ?? null,
      wing: s.wing ?? null,
      placement: s.placement ?? null,
      floorNumber: s.floorNumber ?? null,
      note: s.note ?? null,
      inputFiber: visibleFiber(actor, s.inputFiber),
      onFiber,
      portsTotal: s.outputs.length,
      portsUsed: s.outputs.filter((o) => o.toFiberId || o.toBuildingId).length,
    }
  }

  /**
   * A building a splitter may be put in: it exists, is a visible building, and the user may read it
   * (the Buildings list's rule — zones for a surveyor or manager). Anything else is "no such building".
   */
  async function mustUseBuilding(id, actor) {
    const building = await closureRepository.findBuildingForSplitter(id)
    if (!building || !isVisibleBuilding(building) || !(await buildingReader.canReadBuilding(building.id, actor))) {
      throw ApiError.badRequest('Building does not exist')
    }
    return building
  }

  /** One splitter in full, with its outputs. Out of scope reads exactly like not found. */
  async function splitterDetail(id, actor) {
    const s = await closureRepository.findSplitterDetail(id, splitterScope(actor))
    if (!s) throw ApiError.notFound('Splitter not found')
    return {
      ...splitterSummary(s, actor),
      createdBy: s.createdBy,
      outputs: s.outputs.map((o) => ({
        portNo: o.portNo,
        label: o.label,
        // In use even when the reader cannot open the fiber it feeds.
        used: Boolean(o.toFiberId || o.toBuildingId),
        toFiber: visibleFiber(actor, o.toFiber),
        toBuilding: o.toBuilding,
      })),
    }
  }

  return {
    // The list carries what the closures table, its edit form and the editor's
    // snap targets read; a closure's splitter outputs, creator and full
    // building row come from GET /closures/:id.
    listClosures: async (actor) =>
      Promise.all(
        (await closureRepository.list(closureScope(actor))).map(async (closure) => {
          const { createdBy, building, splitters, ...rest } = await signImages(closure)
          return {
            ...rest,
            building: building ? { id: building.id, buildingName: building.buildingName } : null,
            splitters: (splitters ?? []).map(({ id, ratio }) => ({ id, ratio })),
          }
        }),
      ),

    /** The Splitters page — every splitter in the reader's zones (or their own). */
    async listSplitters(actor) {
      const rows = await closureRepository.listSplitters(splitterScope(actor))
      return rows.map((s) => splitterSummary(s, actor))
    },

    /** One splitter in full. Out of scope reads exactly like not found. */
    getSplitter: (id, actor) => splitterDetail(id, actor),

    /**
     * A splitter fitted inside a building, at the pin the user dropped (spec
     * 2026-11-24-splitter-in-building). The building follows the splitter-output
     * rule (unknown or an unapproved society = no such building); the wing must be
     * one of its wings; the input fiber must be one the user can read.
     */
    async createBuildingSplitter(data, actor) {
      const building = await mustUseBuilding(data.buildingId, actor)
      if (data.wingId && !building.wings.some((w) => w.id === data.wingId)) {
        throw ApiError.badRequest('That wing is not in this building')
      }
      if (data.inputFiberId && !canSeeFiber(actor, await closureRepository.findFiberOwner(data.inputFiberId))) {
        throw ApiError.badRequest('Fiber does not exist')
      }
      const created = await prisma.$transaction(async (tx) =>
        closureRepository.createSplitter(
          {
            code: await sequences.nextSplitterCode(tx),
            latitude: data.latitude,
            longitude: data.longitude,
            buildingId: building.id,
            wingId: data.wingId ?? null,
            placement: data.placement ?? null,
            floorNumber: data.placement === 'FLOOR' ? data.floorNumber : null,
            note: data.note ?? null,
            ratio: data.ratio,
            location: data.location,
            fiberType: data.fiberType ?? null,
            inputFiberId: data.inputFiberId ?? null,
            createdById: actor.id,
          },
          RATIO_PORTS[data.ratio],
          tx,
        ),
      )
      return splitterDetail(created.id, actor)
    },

    async getClosure(id, actor) {
      const closure = await mustFind(id, actor)
      const through = await closureRepository.fibersThrough(id)
      // Only the cables the reader could open themselves.
      const fibers = through.filter(({ fiber }) => canSeeFiber(actor, fiber)).map(({ fiber, pointSeq, maxSeq }) => ({
        ...fiber,
        role: pointSeq === maxSeq ? 'in' : pointSeq === 0 ? 'out' : 'through',
      }))
      return signImages({ ...closure, fibers })
    },

    async createClosure(data, actor) {
      assertOwnedImages(data.images)
      const closure = await prisma.$transaction(async (tx) =>
        closureRepository.create(
          { ...withCableWrites(canonicalImages(data), 'create'), code: await sequences.nextClosureCode(tx), createdById: actor.id },
          tx,
        ),
      )
      return signImages(closure)
    },

    async updateClosure(id, data, actor) {
      await mustFind(id, actor)
      assertOwnedImages(data.images)
      const closure = await signImages(await closureRepository.update(id, withCableWrites(canonicalImages(data), 'update')))
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
      // Where in a building (24 Nov 2026): a wing only on a building splitter and only one of its wings;
      // a floor number goes with FLOOR — leaving Floor clears it, Floor without one is refused.
      // The feed: a new one must be a fibre the editor can read (as on create); "none" from someone who
      // can't read the current feed is their form not knowing it — keep it rather than unlink it.
      if (data.inputFiberId && !canSeeFiber(actor, await closureRepository.findFiberOwner(data.inputFiberId))) {
        throw ApiError.badRequest('Fiber does not exist')
      }
      if (data.inputFiberId === null && splitter.inputFiberId &&
        !canSeeFiber(actor, await closureRepository.findFiberOwner(splitter.inputFiberId))) {
        const { inputFiberId: _keep, ...rest } = data
        data = rest
      }
      // The building (24 Nov 2026): any splitter may be given one later, moved to another, or have it
      // removed — which also clears its wing and where-in-building (the note stays).
      let buildingId = splitter.buildingId
      // A splitter only in a building (no closure, not on a line): the building is its place.
      const buildingOnly = !splitter.closureId && !splitter._count?.points
      if (data.buildingId === null) {
        if (buildingOnly && splitter.buildingId) {
          throw ApiError.badRequest('This splitter is only in its building — change the building instead of removing it')
        }
        buildingId = null
        data = { ...data, wingId: null, placement: null, floorNumber: null }
      } else if (data.buildingId !== undefined) {
        const building = await mustUseBuilding(data.buildingId, actor)
        buildingId = building.id
        // Moved to another building: its pin goes too (a closure / line splitter keeps the closure's / line's).
        if (buildingOnly && building.id !== splitter.buildingId) {
          data = { ...data, latitude: building.latitude, longitude: building.longitude }
        }
        // A wing kept from the old building that isn't in the new one goes.
        if (data.wingId === undefined && splitter.wingId && !building.wings.some((w) => w.id === splitter.wingId)) {
          data = { ...data, wingId: null }
        }
      }
      if (!buildingId && (data.placement || data.floorNumber != null)) {
        throw ApiError.badRequest('Only a splitter in a building has a floor or place')
      }
      if (data.wingId) {
        const wing = await closureRepository.findWing(data.wingId)
        if (!buildingId || !wing || wing.buildingId !== buildingId) {
          throw ApiError.badRequest('That wing is not in this building')
        }
      }
      if (data.placement !== undefined || data.floorNumber !== undefined) {
        const placement = data.placement !== undefined ? data.placement : splitter.placement
        const floorNumber = data.floorNumber !== undefined ? data.floorNumber : splitter.floorNumber
        if (placement === 'FLOOR' && floorNumber == null) throw ApiError.badRequest('Which floor?')
        data = { ...data, floorNumber: placement === 'FLOOR' ? floorNumber : null }
      }
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
      // Same rule as a fibre's BUILDING point: an unknown id and a society not
      // yet approved are both "no such building".
      if (data.toBuildingId) {
        const b = await closureRepository.findBuildingForOutput(data.toBuildingId)
        if (!b || !isVisibleBuilding(b)) throw ApiError.badRequest('Building does not exist')
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
  storage: getStorageProvider(),
})
