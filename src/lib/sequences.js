// Postgres sequences created in migration 20260913000000_fiber_network.
// Called inside the save transaction so two admins never get the same code.
async function nextval(tx, seq) {
  const [{ n }] = await tx.$queryRawUnsafe(`SELECT nextval('"${seq}"')::int AS n`)
  return n
}
export const nextFiberName = async (tx) => `FIB-${String(await nextval(tx, 'Fiber_name_seq')).padStart(3, '0')}`
export const nextClosureCode = async (tx) => `CL-${String(await nextval(tx, 'Closure_code_seq')).padStart(4, '0')}`
