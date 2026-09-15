import { pathMeters } from '../../lib/fiber-geo.js'

export const entityKey = (p) =>
  p.type === 'POP' ? `POP:${p.popId}` : p.type === 'CLOSURE' ? `CLOSURE:${p.closureId}` : p.type === 'BUILDING' ? `BUILDING:${p.buildingId}` : null

/** Consecutive typed points bound a segment; the waypoints between them give its map length. */
export function deriveSegments(points) {
  const typed = points.map((p, index) => ({ p, index })).filter(({ p }) => p.type !== 'WAYPOINT')
  const segments = []
  for (let k = 1; k < typed.length; k++) {
    const from = typed[k - 1], to = typed[k]
    segments.push({
      sequence: k - 1, fromIndex: from.index, toIndex: to.index,
      fromKey: entityKey(from.p), toKey: entityKey(to.p),
      mapMeters: pathMeters(points.slice(from.index, to.index + 1)),
    })
  }
  return segments
}

/**
 * The stored segments of a loaded fiber, restated in the entity-pair form
 * `carryForward` matches on. Both the edit path and the merge-points path
 * redraw a fiber's geometry, so both need it.
 */
export function keyedSegments(fiber) {
  const byId = Object.fromEntries(fiber.points.map((p) => [p.id, p]))
  return fiber.segments.map((s) => ({
    ...s,
    fromKey: entityKey(byId[s.fromPointId]),
    toKey: entityKey(byId[s.toPointId]),
  }))
}

/** User-entered values survive a redraw as long as the segment's two endpoints do (spec §2.12 step 6). */
export function carryForward(oldSegments, newSegments) {
  const byPair = new Map(oldSegments.map((s) => [`${s.fromKey}>${s.toKey}`, s]))
  return newSegments.map((s) => {
    const match = byPair.get(`${s.fromKey}>${s.toKey}`)
    return match ? { ...s, fiberLaidMeters: match.fiberLaidMeters, isCut: match.isCut, cutAt: match.cutAt, cutNote: match.cutNote } : s
  })
}

/** A line cannot pass through a splitter (spec §2.4). closuresById: { [id]: { splitters: [] } } */
export function splitterPlacementErrors(points, closuresById, fromSplitterOutput) {
  const errors = []
  points.forEach((p, i) => {
    if (p.type !== 'CLOSURE' || !closuresById[p.closureId]?.splitters?.length) return
    const isLast = i === points.length - 1
    const isFedStart = i === 0 && fromSplitterOutput?.closureId === p.closureId
    if (!isLast && !isFedStart) errors.push(`Point ${i + 1}: a line cannot pass through a splitter closure — end the fiber there and start a new one`)
  })
  return errors
}
