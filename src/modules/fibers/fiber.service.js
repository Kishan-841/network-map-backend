import { ApiError } from '../../lib/api-error.js'
import { prisma } from '../../lib/prisma.js'
import { pathMeters } from '../../lib/fiber-geo.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { nextFiberName, nextClosureCode } from '../../lib/sequences.js'
import { deriveSegments, carryForward, splitterPlacementErrors, entityKey } from './fiber-geometry.js'
import { collectDownstream } from './fiber-downstream.js'
import { fiberRepository } from './fiber.repository.js'
import { closureRepository } from '../closures/closure.repository.js'
import { popRepository } from '../pops/pop.repository.js'
import { buildingRepository } from '../buildings/building.repository.js'

const RATIO_LABEL = { R1_2: '1:2', R1_4: '1:4', R1_8: '1:8', R1_16: '1:16' }

export function shapeFiber(fiber, extras = {}) {
  const points = fiber.points.map((p) => ({
    ...p,
    label: p.pop?.name ?? p.closure?.code ?? p.building?.buildingName ?? null,
    splitter: p.closure?.splitters?.[0] ? RATIO_LABEL[p.closure.splitters[0].ratio] : null,
  }))
  return {
    ...fiber,
    points,
    totals: {
      mapMeters: fiber.segments.reduce((n, s) => n + s.mapMeters, 0),
      fiberLaidMeters: fiber.segments.reduce((n, s) => n + (s.fiberLaidMeters ?? 0), 0),
      closureCount: points.filter((p) => p.type === 'CLOSURE').length,
      pathMeters: pathMeters(points),
    },
    ...extras,
  }
}

export function createFiberService(deps) {
  const { fiberRepository, closureRepository, popRepository, buildingRepository, storage, sequences, prisma } = deps

  async function assertNameFree(name, selfId) {
    const clash = await fiberRepository.findByName(name)
    if (clash && clash.id !== selfId) throw ApiError.conflict('A fiber with this name already exists')
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
  async function signImages(fiber) {
    if (!fiber?.images?.length || !storage?.readUrl) return fiber
    return { ...fiber, images: await Promise.all(fiber.images.map((u) => storage.readUrl(u))) }
  }

  async function resolvePoints(points, tx) {
    // Typed points take the entity's coordinates; new closures/POPs are created here (spec §2.12 steps 2–3).
    const out = []
    for (const p of points) {
      if (p.type === 'WAYPOINT') {
        out.push({ type: 'WAYPOINT', latitude: p.latitude, longitude: p.longitude })
        continue
      }
      if (p.type === 'POP') {
        const pop = p.newPop
          ? await popRepository.create({ name: p.newPop.name, latitude: p.latitude, longitude: p.longitude }, tx)
          : await popRepository.findById(p.popId)
        if (!pop) throw ApiError.badRequest('POP does not exist')
        out.push({ type: 'POP', popId: pop.id, latitude: pop.latitude, longitude: pop.longitude })
      } else if (p.type === 'CLOSURE') {
        const closure = p.newClosure
          ? await closureRepository.create(
              {
                code: await sequences.nextClosureCode(tx),
                latitude: p.latitude,
                longitude: p.longitude,
                kind: p.newClosure.kind ?? null,
              },
              tx,
            )
          : await closureRepository.findById(p.closureId)
        if (!closure) throw ApiError.badRequest('Closure does not exist')
        out.push({ type: 'CLOSURE', closureId: closure.id, latitude: closure.latitude, longitude: closure.longitude })
      } else {
        const b = await buildingRepository.findById(p.buildingId)
        if (!b) throw ApiError.badRequest('Building does not exist')
        out.push({ type: 'BUILDING', buildingId: b.id, latitude: b.latitude, longitude: b.longitude })
      }
    }
    return out
  }

  async function assertPort(data, selfId) {
    if (data.oltId == null) return
    const olt = await popRepository.findOltById(data.oltId)
    if (!olt) throw ApiError.badRequest('OLT does not exist')
    if (data.ponPort > olt.ponPortCount) throw ApiError.badRequest(`OLT has only ${olt.ponPortCount} PON ports`)
    const taken = await fiberRepository.findUsingPort(data.oltId, data.ponPort)
    if (taken && taken.id !== selfId) throw ApiError.conflict(`Port ${data.ponPort} already feeds ${taken.name}`)
  }

  async function assertSplitterRules(points, fromSplitterOutput, selfId) {
    const closureIds = points.filter((p) => p.type === 'CLOSURE').map((p) => p.closureId)
    const closures = Object.fromEntries((await closureRepository.findManyWithSplitters(closureIds)).map((c) => [c.id, c]))
    let feed = null
    if (fromSplitterOutput) {
      const splitter = await closureRepository.findSplitterById(fromSplitterOutput.splitterId)
      if (!splitter) throw ApiError.badRequest('Splitter does not exist')
      const output = splitter.outputs.find((o) => o.portNo === fromSplitterOutput.portNo)
      if (!output) throw ApiError.badRequest('That splitter has no such output')
      if (output.toFiberId && output.toFiberId !== selfId) {
        throw ApiError.conflict(`Output ${output.portNo} already feeds another fiber`)
      }
      if (points[0]?.closureId !== splitter.closureId) {
        throw ApiError.badRequest('A fiber fed by a splitter must start at that closure')
      }
      feed = { ...fromSplitterOutput, closureId: splitter.closureId }
    }
    const errors = splitterPlacementErrors(points, closures, feed)
    if (errors.length) throw ApiError.badRequest(errors[0])
  }

  function applyLaid(segments, laid) {
    if (laid == null) return segments
    if (laid.length !== segments.length) {
      throw ApiError.badRequest(`Expected ${segments.length} segment values, got ${laid.length}`)
    }
    return segments.map((s, i) => ({ ...s, fiberLaidMeters: laid[i] ?? s.fiberLaidMeters }))
  }

  /**
   * The feed an edit ends up with. An absent key keeps the stored one (it still
   * has to satisfy the "starts at the splitter's closure" rule); an explicit
   * null is a detach, so it inherits nothing.
   */
  const mergedFeed = (data, oldFiber) => {
    if (data.fromSplitterOutput !== undefined) return data.fromSplitterOutput
    return oldFiber?.fedBy ? { splitterId: oldFiber.fedBy.splitter.id, portNo: oldFiber.fedBy.portNo } : null
  }

  async function saveGeometry(fiberId, rawPoints, data, oldFiber, tx) {
    const points = await resolvePoints(rawPoints, tx)
    await assertSplitterRules(points, mergedFeed(data, oldFiber), fiberId)
    let segments = deriveSegments(points)
    if (oldFiber) {
      const byId = Object.fromEntries(oldFiber.points.map((p) => [p.id, p]))
      const old = oldFiber.segments.map((s) => ({
        ...s,
        fromKey: entityKey(byId[s.fromPointId]),
        toKey: entityKey(byId[s.toPointId]),
      }))
      segments = carryForward(old, segments)
    }
    segments = applyLaid(segments, data.segmentLaidMeters)
    await fiberRepository.replaceGeometry(fiberId, points, segments, tx)
    if (data.fromSplitterOutput) {
      await closureRepository.updateOutput(
        data.fromSplitterOutput.splitterId,
        data.fromSplitterOutput.portNo,
        { toFiberId: fiberId },
        tx,
      )
    }
    // The fiber ends on a splitter closure whose splitter has no input yet → this fiber feeds it.
    const last = points.at(-1)
    if (last.type === 'CLOSURE') await closureRepository.claimSplitterInput(last.closureId, fiberId, tx)
  }

  const detailsOf = ({ points, segmentLaidMeters, fromSplitterOutput, ...rest }) => rest

  async function getFiber(id) {
    const fiber = await fiberRepository.findById(id)
    if (!fiber) throw ApiError.notFound('Fiber not found')
    const splitters = await fiberRepository.splittersFedBy(id)
    const shaped = shapeFiber(await signImages(fiber), { splitters })
    const downstream =
      fiber.status === 'CUT'
        ? await collectDownstream({
            fiber: shaped,
            splittersFedBy: (fid) => fiberRepository.splittersFedBy(fid),
            loadFiber: async (fid) => shapeFiber(await fiberRepository.findById(fid)),
          })
        : null
    return { ...shaped, downstream }
  }

  return {
    getFiber,

    async listFibers() {
      return Promise.all((await fiberRepository.list()).map(async (f) => shapeFiber(await signImages(f))))
    },

    async createFiber(data) {
      if (data.name) await assertNameFree(data.name)
      await assertPort(data)
      assertOwnedImages(data.images)
      const id = await prisma.$transaction(async (tx) => {
        const name = data.name ?? (await sequences.nextFiberName(tx))
        const fiber = await fiberRepository.create({ ...canonicalImages(detailsOf(data)), name }, tx)
        await saveGeometry(fiber.id, data.points, data, null, tx)
        return fiber.id
      })
      return getFiber(id)
    },

    async updateFiber(id, data) {
      const existing = await fiberRepository.findById(id)
      if (!existing) throw ApiError.notFound('Fiber not found')
      if (data.name) await assertNameFree(data.name, id)
      // A PATCH is a fragment, so the create schema's cross-field rules are
      // re-run here against what the fiber will actually look like afterwards.
      // Only an absent key inherits; an explicit null clears.
      const oltId = data.oltId === undefined ? existing.oltId : data.oltId
      const ponPort = data.ponPort === undefined ? existing.ponPort : data.ponPort
      if ((oltId == null) !== (ponPort == null)) throw ApiError.badRequest('oltId and ponPort go together')
      if (mergedFeed(data, existing) && oltId != null) {
        throw ApiError.badRequest('A fiber fed by a splitter has no OLT port of its own')
      }
      await assertPort({ oltId, ponPort }, id)
      assertOwnedImages(data.images)
      await prisma.$transaction(async (tx) => {
        await fiberRepository.update(id, canonicalImages(detailsOf(data)), tx)
        // An explicit null hands the splitter output back before any new geometry
        // claims one, so a detach works whether or not the points were redrawn.
        if (data.fromSplitterOutput === null && existing.fedBy) {
          await closureRepository.updateOutput(
            existing.fedBy.splitter.id,
            existing.fedBy.portNo,
            { toFiberId: null },
            tx,
          )
        }
        if (data.points) await saveGeometry(id, data.points, data, existing, tx)
      })
      return getFiber(id)
    },

    async deleteFiber(id) {
      if (!(await fiberRepository.findById(id))) throw ApiError.notFound('Fiber not found')
      await fiberRepository.delete(id)
    },

    async setSegmentLaid(fiberId, segmentId, { fiberLaidMeters }) {
      if (!(await fiberRepository.findSegment(fiberId, segmentId))) throw ApiError.notFound('Segment not found')
      await fiberRepository.updateSegment(segmentId, { fiberLaidMeters })
      return getFiber(fiberId)
    },

    async cutFiber(fiberId, { segmentId, note }) {
      if (!(await fiberRepository.findSegment(fiberId, segmentId))) throw ApiError.notFound('Segment not found')
      await fiberRepository.cutSegment(fiberId, segmentId, note)
      return getFiber(fiberId)
    },

    async restoreFiber(fiberId) {
      if (!(await fiberRepository.findById(fiberId))) throw ApiError.notFound('Fiber not found')
      await fiberRepository.restoreAll(fiberId)
      return getFiber(fiberId)
    },
  }
}

export const fiberService = createFiberService({
  fiberRepository,
  closureRepository,
  popRepository,
  buildingRepository,
  storage: getStorageProvider(),
  sequences: { nextFiberName, nextClosureCode },
  prisma,
})
