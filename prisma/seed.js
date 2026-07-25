import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@isp.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!'

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      name: 'System Admin',
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'ADMIN',
    },
  })

  const zones = [
    { name: 'Zone A', city: 'Default City' },
    { name: 'Zone B', city: 'Default City' },
  ]
  for (const zone of zones) {
    await prisma.zone.upsert({
      where: { name: zone.name },
      update: {},
      create: zone,
    })
  }

  const buildingTypes = ['Residential', 'Commercial', 'Mixed Use', 'Industrial']
  for (const name of buildingTypes) {
    await prisma.buildingType.upsert({
      where: { name },
      update: {},
      create: { name },
    })
  }

  console.log(
    `Seeded admin ${ADMIN_EMAIL}, ${zones.length} zones, ${buildingTypes.length} building types`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
