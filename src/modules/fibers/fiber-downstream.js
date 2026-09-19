/** Everything that loses light when `fiber` is cut (spec §2.13). Recursive over splitter outputs, depth ≤ 20. */
export async function collectDownstream({ fiber, splittersFedBy, loadFiber }) {
  const buildings = new Map(), fibers = new Map(), visited = new Set()
  async function walk(f, fromSequence, depth) {
    if (depth > 20 || visited.has(f.id)) return
    visited.add(f.id)
    for (const p of f.points) if (p.sequence > fromSequence && p.type === 'BUILDING') buildings.set(p.buildingId, { id: p.buildingId, buildingName: p.label })
    // A splitter is reached past the cut either through a closure the line
    // still visits, or as a point of its own on the line.
    const later = f.points.filter((p) => p.sequence > fromSequence)
    const laterClosures = new Set(later.filter((p) => p.type === 'CLOSURE').map((p) => p.closureId))
    const laterSplitters = new Set(later.filter((p) => p.type === 'SPLITTER').map((p) => p.splitterId))
    for (const s of await splittersFedBy(f.id)) {
      if (!(s.closureId ? laterClosures.has(s.closureId) : laterSplitters.has(s.id))) continue
      for (const o of s.outputs) {
        if (o.toBuilding) buildings.set(o.toBuilding.id, o.toBuilding)
        if (o.toFiber) { fibers.set(o.toFiber.id, { id: o.toFiber.id, name: o.toFiber.name, createdById: o.toFiber.createdById ?? null }); await walk(await loadFiber(o.toFiber.id), -1, depth + 1) }
      }
    }
  }
  const firstCut = fiber.segments.find((s) => s.isCut)
  if (!firstCut) return { buildings: [], fibers: [] }
  const cutFrom = fiber.points.find((p) => p.id === firstCut.fromPointId)?.sequence ?? -1
  await walk(fiber, cutFrom, 0)
  return { buildings: [...buildings.values()], fibers: [...fibers.values()] }
}
