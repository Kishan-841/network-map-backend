/**
 * Turns a closure's `cables` list (already validated) into the Prisma nested
 * write that stores it. `undefined` means the request did not mention cables,
 * so the stored rows are left alone. Otherwise the list replaces what is
 * stored — on update that is a deleteMany + create inside the same update call,
 * so it happens in one statement batch.
 */
export function cableWrites(cables, mode = 'create') {
  if (cables === undefined) return undefined
  const seen = { IN: 0, OUT: 0 }
  const create = (cables ?? []).map((c) => ({
    direction: c.direction,
    cableType: c.cableType ?? null,
    coreCount: c.coreCount ?? null,
    cableTag: c.cableTag ?? null,
    position: seen[c.direction]++,
  }))
  return mode === 'update' ? { deleteMany: {}, create } : { create }
}

/** `data` with its `cables` swapped for the nested write (or dropped when absent). */
export function withCableWrites(data, mode) {
  const { cables, ...rest } = data
  const writes = cableWrites(cables, mode)
  return writes ? { ...rest, cables: writes } : rest
}
