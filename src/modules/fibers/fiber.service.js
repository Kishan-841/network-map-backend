import { Prisma } from '@prisma/client'
import { ApiError } from '../../lib/api-error.js'
import { prisma } from '../../lib/prisma.js'
import { pathMeters } from '../../lib/fiber-geo.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { nextFiberName, nextClosureCode, nextSplitterCode } from '../../lib/sequences.js'
import { deriveSegments, carryForward, keyedSegments } from './fiber-geometry.js'
import { findJunctions } from './fiber-junctions.js'
import { collectDownstream } from './fiber-downstream.js'
import { fiberRepository } from './fiber.repository.js'
import { closureRepository } from '../closures/closure.repository.js'
import { RATIO_PORTS } from '../closures/closure.schemas.js'
import { popRepository } from '../pops/pop.repository.js'
import { buildingRepository } from '../buildings/building.repository.js'

const RATIO_LABEL = { R1_2: '1:2', R1_4: '1:4', R1_6: '1:6', R1_8: '1:8', R1_16: '1:16' }

export function shapeFiber(fiber, extras = {}) {
  const points = fiber.points.map((p) => {
    // A SPLITTER point IS the splitter; a CLOSURE point may still carry a
    // legacy one attached to the closure. Either way the same four fields
    // describe it, so the client reads one shape.
    const splitter = p.splitter ?? p.closure?.splitters?.[0] ?? null
    return {
      ...p,
      label: p.pop?.name ?? p.closure?.code ?? p.building?.buildingName ?? p.splitter?.code ?? null,
      splitter: splitter ? RATIO_LABEL[splitter.ratio] : null,
      splitterId: splitter?.id ?? null,
      splitterRatio: splitter?.ratio ?? null,
      splitterLocation: splitter?.location ?? null,
      splitterFiberType: splitter?.fiberType ?? null,
      kind: p.closure?.kind ?? null,
    }
  })
  return {
    ...fiber,
    points,
    totals: {
      mapMeters: fiber.segments.reduce((n, s) => n + s.mapMeters, 0),
      fiberLaidMeters: fiber.segments.reduce((n, s) => n + (s.fiberLaidMeters ?? 0), 0),
      closureCount: points.filter((p) => p.type === 'CLOSURE').length,
      splitterCount: points.filter((p) => p.type === 'SPLITTER').length,
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
    // Prisma needs DbNull (not JS null) to clear a Json? column to SQL NULL.
    if (data.images === null) return { ...data, images: Prisma.DbNull }
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

  async function resolvePoints(points, fiberId, tx) {
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
                notes: p.newClosure.notes ?? null,
              },
              tx,
            )
          : await closureRepository.findById(p.closureId)
        if (!closure) throw ApiError.badRequest('Closure does not exist')
        out.push({ type: 'CLOSURE', closureId: closure.id, latitude: closure.latitude, longitude: closure.longitude })
      } else if (p.type === 'SPLITTER') {
        const splitter = p.newSplitter
          ? await closureRepository.createSplitter(
              {
                code: await sequences.nextSplitterCode(tx),
                latitude: p.latitude,
                longitude: p.longitude,
                ratio: p.newSplitter.ratio,
                location: p.newSplitter.location ?? 'WAN',
                fiberType: p.newSplitter.fiberType ?? null,
                // The line it sits on is the line that feeds it.
                inputFiberId: fiberId,
                closureId: null,
              },
              RATIO_PORTS[p.newSplitter.ratio],
              tx,
            )
          : await closureRepository.findSplitterById(p.splitterId)
        if (!splitter) throw ApiError.badRequest('Splitter does not exist')
        out.push({
          type: 'SPLITTER',
          splitterId: splitter.id,
          latitude: splitter.latitude,
          longitude: splitter.longitude,
        })
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

  /**
   * A splitter may sit on any closure of a line, so there is no placement rule
   * left — only the ownership of the output a fed fiber claims.
   */
  async function assertSplitterRules(points, fromSplitterOutput, selfId) {
    if (!fromSplitterOutput) return
    const splitter = await closureRepository.findSplitterById(fromSplitterOutput.splitterId)
    if (!splitter) throw ApiError.badRequest('Splitter does not exist')
    const output = splitter.outputs.find((o) => o.portNo === fromSplitterOutput.portNo)
    if (!output) throw ApiError.badRequest('That splitter has no such output')
    if (output.toFiberId && output.toFiberId !== selfId) {
      throw ApiError.conflict(`Output ${output.portNo} already feeds another fiber`)
    }
    // A splitter on a closure is reached at that closure; one dropped on a line
    // is reached at its own point.
    if (splitter.closureId) {
      if (points[0]?.closureId !== splitter.closureId) {
        throw ApiError.badRequest('A fiber fed by a splitter must start at that closure')
      }
    } else if (points[0]?.splitterId !== splitter.id) {
      throw ApiError.badRequest('A fiber fed by a splitter must start at that splitter')
    }
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
    const points = await resolvePoints(rawPoints, fiberId, tx)
    await assertSplitterRules(points, mergedFeed(data, oldFiber), fiberId)
    let segments = deriveSegments(points)
    if (oldFiber) segments = carryForward(keyedSegments(oldFiber), segments)
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

  const MAX_MERGE_POINTS = 50

  const centroid = (points) => ({
    latitude: points.reduce((n, p) => n + p.latitude, 0) / points.length,
    longitude: points.reduce((n, p) => n + p.longitude, 0) / points.length,
  })

  /** The entity every selected point is about to become, plus how to describe it back. */
  async function resolveMergeTarget({ type, popId, kind }, selected, tx) {
    if (type === 'POP') {
      const pop = popId ? await popRepository.findById(popId) : null
      if (!pop) throw ApiError.badRequest('POP does not exist')
      return {
        entity: { type: 'POP', id: pop.id, name: pop.name },
        point: { type: 'POP', popId: pop.id, latitude: pop.latitude, longitude: pop.longitude },
      }
    }
    const centre = centroid(selected)
    const closure = await closureRepository.create(
      { code: await sequences.nextClosureCode(tx), latitude: centre.latitude, longitude: centre.longitude, kind: kind ?? null },
      tx,
    )
    return {
      entity: { type: 'CLOSURE', id: closure.id, code: closure.code },
      point: { type: 'CLOSURE', closureId: closure.id, latitude: closure.latitude, longitude: closure.longitude },
    }
  }

  /** A stored point restated as the plain shape `replaceGeometry` writes back. */
  const asPlainPoint = (p) => ({
    type: p.type,
    popId: p.popId ?? null,
    closureId: p.closureId ?? null,
    buildingId: p.buildingId ?? null,
    splitterId: p.splitterId ?? null,
    latitude: p.latitude,
    longitude: p.longitude,
  })

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
        } else if (
          data.fromSplitterOutput &&
          existing.fedBy &&
          (existing.fedBy.splitter.id !== data.fromSplitterOutput.splitterId ||
            existing.fedBy.portNo !== data.fromSplitterOutput.portNo)
        ) {
          // Swapping feeds: release the old output before saveGeometry claims the
          // new one below, or the old and new outputs both trying to hold this
          // fiber's id trips the toFiberId unique index and 500s.
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

    /** Piles of migrated endpoints that look like one pole (spec §2.15). */
    async listJunctions({ radiusMeters = 10 } = {}) {
      return findJunctions(await fiberRepository.listEndpointWaypoints(), radiusMeters)
    },

    /**
     * Turns a cluster of loose waypoints into one shared entity: the selected
     * points all become the same CLOSURE (minted here, at their centroid) or the
     * same existing POP, and every fiber they belong to is redrawn so the shared
     * point bounds real segments instead of being an untyped bend.
     */
    async mergePoints({ pointIds, type, popId, kind }) {
      const ids = [...new Set(pointIds)]
      if (ids.length < 2) throw ApiError.badRequest('Select at least two distinct points')
      if (ids.length > MAX_MERGE_POINTS) throw ApiError.badRequest(`At most ${MAX_MERGE_POINTS} points can be merged at once`)

      const selected = await fiberRepository.findPointsByIds(ids)
      // A missing id and a typed id fail the same way — either means the
      // selection no longer describes a mergeable pile of loose ends.
      if (selected.length !== ids.length || selected.some((p) => p.type !== 'WAYPOINT')) {
        throw ApiError.badRequest('Only waypoints can be merged')
      }
      const fiberIds = [...new Set(selected.map((p) => p.fiberId))]
      if (fiberIds.length < 2) throw ApiError.badRequest('Merging needs points from at least two different fibers')

      const selectedIds = new Set(ids)
      return prisma.$transaction(async (tx) => {
        const target = await resolveMergeTarget({ type, popId, kind }, selected, tx)
        const fibers = []
        for (const fiberId of fiberIds) {
          const fiber = await fiberRepository.findById(fiberId, tx)
          if (!fiber) throw ApiError.badRequest('Fiber not found')
          const points = fiber.points.map((p) => (selectedIds.has(p.id) ? { ...target.point } : asPlainPoint(p)))
          const segments = carryForward(keyedSegments(fiber), deriveSegments(points))
          await fiberRepository.replaceGeometry(fiberId, points, segments, tx)
          fibers.push({ id: fiber.id, name: fiber.name })
        }
        return { entity: target.entity, fibers }
      })
    },

    async deleteFiber(id) {
      const fiber = await fiberRepository.findById(id)
      if (!fiber) throw ApiError.notFound('Fiber not found')
      // Splitters that live on this line and nowhere else go with it; the
      // repository keeps any that are still attached to a closure.
      const lineSplitterIds = [...new Set(fiber.points.filter((p) => p.splitterId).map((p) => p.splitterId))]
      await fiberRepository.delete(id, lineSplitterIds)
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
  sequences: { nextFiberName, nextClosureCode, nextSplitterCode },
  prisma,
})
