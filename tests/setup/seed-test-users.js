import { prisma } from '../../src/lib/prisma.js'

// requireAuth now re-reads the user each request (immediate deactivation /
// role changes), so route tests that sign synthetic tokens need matching users
// to exist and be active. Seed fixed-id users once before the suite runs.
const TEST_USERS = [
  { id: 'test-admin', role: 'ADMIN' },
  { id: 'test-manager', role: 'MANAGER' },
  // Fiber writes are a per-user grant now; this is the ticked manager.
  { id: 'test-fiber-manager', role: 'MANAGER', canManageFiber: true },
  { id: 'test-surveyor', role: 'SURVEYOR' },
  { id: 'test-user', role: 'SURVEYOR' },
]

export async function setup() {
  for (const { id, role, canManageFiber = false } of TEST_USERS) {
    await prisma.user.upsert({
      where: { id },
      update: { role, isActive: true, canManageFiber },
      create: {
        id,
        name: `Test ${role}`,
        email: `${id}@vitest.local`,
        passwordHash: 'x',
        role,
        isActive: true,
        canManageFiber,
      },
    })
  }
}
