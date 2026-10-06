import { prisma } from '../../lib/prisma.js'

const SETTING_ID = 'singleton'

export const appReleaseRepository = {
  list: () =>
    prisma.appRelease.findMany({ orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { id: true, name: true } } } }),
  findByVersion: (version) => prisma.appRelease.findUnique({ where: { version } }),
  create: (data) => prisma.appRelease.create({ data }),
  // The migration inserts the row; upsert keeps a fresh database working too.
  getSetting: () => prisma.appReleaseSetting.upsert({ where: { id: SETTING_ID }, update: {}, create: { id: SETTING_ID } }),
  setMinimum: (minimumSupportedVersion, updatedById) =>
    prisma.appReleaseSetting.upsert({
      where: { id: SETTING_ID },
      update: { minimumSupportedVersion, updatedById },
      create: { id: SETTING_ID, minimumSupportedVersion, updatedById },
    }),
}
