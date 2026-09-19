import { Prisma } from '@prisma/client'
import { ApiError } from '../../lib/api-error.js'
import { popRepository } from './pop.repository.js'
import { fiberPointRepository } from '../fibers/fiber.repository.js'
import { zoneRepository } from '../zones/zone.repository.js'
import { userRepository } from '../users/user.repository.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { prisma } from '../../lib/prisma.js'

export function createPopService({
  popRepository,
  fiberPointRepository,
  zoneRepository,
  userRepository,
  storage,
  prisma,
}) {
  /**
   * Bring a POP's child rows in line with the list the client saved.
   *
   * A row with an `id` is kept and updated, a row without one is created, and
   * a row the client no longer lists is deleted — the same "the form owns the
   * whole list" contract the building form uses for zones. All inside the
   * caller's transaction, so a clash halfway leaves nothing behind.
   */
  async function syncOlts(popId, rows, tx) {
    if (!rows) return
    const names = rows.map((row) => row.name.trim().toLowerCase())
    if (new Set(names).size !== names.length) {
      throw ApiError.conflict('Two OLTs cannot share a name')
    }
    const existing = await tx.olt.findMany({ where: { popId } })
    const kept = new Set(rows.map((row) => row.id).filter(Boolean))
    for (const olt of existing) {
      if (kept.has(olt.id)) continue
      // The same guard the standalone delete route applies: a fiber leaving
      // this port is real equipment, not a row to tidy away.
      if ((await tx.fiber.count({ where: { oltId: olt.id } })) > 0) {
        throw ApiError.conflict(`OLT '${olt.name}' still feeds fibers — retype them first`)
      }
      await tx.olt.delete({ where: { id: olt.id } })
    }
    for (const { id, ...data } of rows) {
      if (id) await tx.olt.update({ where: { id }, data })
      else await tx.olt.create({ data: { ...data, popId } })
    }
  }

  async function syncDevices(popId, rows, tx) {
    if (!rows) return
    const kept = new Set(rows.map((row) => row.id).filter(Boolean))
    await tx.popDevice.deleteMany({ where: { popId, id: { notIn: [...kept] } } })
    for (const { id, ...data } of rows) {
      assertDeviceRules(data)
      if (id) await tx.popDevice.update({ where: { id }, data })
      else await tx.popDevice.create({ data: { ...data, popId } })
    }
  }

  /**
   * Rack photos follow the same rule as building photos and fiber images: the
   * stored URL is the object's identity, the link handed to a browser is
   * short-lived and signed, and only our own uploads may be stored.
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
  async function signImages(pop) {
    if (!pop?.images?.length || !storage?.readUrl) return pop
    return { ...pop, images: await Promise.all(pop.images.map((u) => storage.readUrl(u))) }
  }

  /** A device belongs to exactly one POP; reaching it through another is a 404. */
  async function mustFindDevice(popId, deviceId) {
    const device = await popRepository.findDeviceById(deviceId)
    if (!device || device.popId !== popId) throw ApiError.notFound('Device not found')
    return device
  }

  /**
   * What each kind must carry. Re-checked here as well as in the schema,
   * because a PATCH is a fragment: clearing the address of a switch has to
   * fail even though the fragment itself looks fine.
   */
  function assertDeviceRules(device) {
    if ((device.kind === 'SWITCH' || device.kind === 'MIKROTIK') && !device.ipAddress) {
      throw ApiError.badRequest('An address is what we came for')
    }
    if (device.kind === 'FMS' && device.portCount == null) {
      throw ApiError.badRequest('How many ports does it have?')
    }
  }

  async function mustFind(id) {
    const pop = await popRepository.findById(id)
    if (!pop) throw ApiError.notFound('POP not found')
    return pop
  }
  async function assertNameFree(name, selfId) {
    const clash = await popRepository.findByName(name)
    if (clash && clash.id !== selfId) throw ApiError.conflict('A POP with this name already exists')
  }
  async function mustFindOlt(popId, oltId) {
    const olt = await popRepository.findOltById(oltId)
    if (!olt || olt.popId !== popId) throw ApiError.notFound('OLT not found')
    return olt
  }
  /**
   * The zone a POP sits in must exist, and a SURVEYOR may only use the zones
   * they are assigned to — the same rule that governs where they may log a
   * building or draw a fiber. Managers and above work every zone.
   */
  async function assertZone(zoneId, actor) {
    if (!zoneId) return
    const zone = await zoneRepository.findById(zoneId)
    if (!zone) throw ApiError.badRequest('Zone does not exist')
    if (actor?.role === 'SURVEYOR') {
      const assigned = await userRepository.assignedZoneIds(actor.id)
      if (!assigned.includes(zoneId)) throw ApiError.forbidden('You are not assigned to this zone')
    }
  }

  /**
   * What a reader may see. A surveyor gets the POPs in their own zones, plus
   * any POP recorded before zones existed — those belong to nobody yet, so
   * hiding them would make sites disappear from a map that always had them.
   */
  async function listScope(actor) {
    if (actor?.role !== 'SURVEYOR') return {}
    const assigned = await userRepository.assignedZoneIds(actor.id)
    return { OR: [{ zoneId: { in: assigned } }, { zoneId: null }] }
  }

  return {
    async listPops(actor) {
      const pops = await popRepository.list(await listScope(actor))
      return Promise.all(pops.map(signImages))
    },
    async createPop({ olts, devices, ...data }, actor) {
      await assertZone(data.zoneId, actor)
      await assertNameFree(data.name)
      assertOwnedImages(data.images)
      const id = await prisma.$transaction(async (tx) => {
        const pop = await tx.pop.create({ data: canonicalImages(data) })
        await syncOlts(pop.id, olts, tx)
        await syncDevices(pop.id, devices, tx)
        return pop.id
      })
      return signImages(await popRepository.findById(id))
    },
    async updatePop(id, { olts, devices, ...data }, actor) {
      const existing = await mustFind(id)
      if (data.zoneId !== undefined && data.zoneId !== existing.zoneId) {
        await assertZone(data.zoneId, actor)
      }
      if (data.name) await assertNameFree(data.name, id)
      assertOwnedImages(data.images)
      await prisma.$transaction(async (tx) => {
        await tx.pop.update({ where: { id }, data: canonicalImages(data) })
        await syncOlts(id, olts, tx)
        await syncDevices(id, devices, tx)
      })
      const pop = await popRepository.findById(id)
      // A POP's position is the truth for every fiber point that sits on it (spec §2.8).
      if (data.latitude != null && data.longitude != null) {
        await fiberPointRepository.updatePositionForPop(id, {
          latitude: data.latitude,
          longitude: data.longitude,
        })
      }
      return signImages(pop)
    },
    async deletePop(id) {
      await mustFind(id)
      if ((await popRepository.countPointsForPop(id)) > 0) {
        throw ApiError.conflict('Fibers still start at this POP — retype or delete them first')
      }
      await popRepository.delete(id)
    },
    async addDevice(popId, data) {
      await mustFind(popId)
      assertDeviceRules(data)
      return popRepository.createDevice({ ...data, popId })
    },

    async updateDevice(popId, deviceId, data) {
      const existing = await mustFindDevice(popId, deviceId)
      assertDeviceRules({ ...existing, ...data })
      return popRepository.updateDevice(deviceId, data)
    },

    async removeDevice(popId, deviceId) {
      await mustFindDevice(popId, deviceId)
      await popRepository.deleteDevice(deviceId)
    },

    async createOlt(popId, data) {
      await mustFind(popId)
      const clash = await popRepository.findOltByName(popId, data.name)
      if (clash) throw ApiError.conflict('An OLT with this name already exists at this POP')
      return popRepository.createOlt({ ...data, popId })
    },
    async updateOlt(popId, oltId, data) {
      await mustFindOlt(popId, oltId)
      if (data.ponPortCount != null) {
        const used = await popRepository.maxUsedPort(oltId)
        if (data.ponPortCount < used) {
          throw ApiError.conflict(`Port ${used} is in use — cannot reduce below it`)
        }
      }
      return popRepository.updateOlt(oltId, data)
    },
    async deleteOlt(popId, oltId) {
      await mustFindOlt(popId, oltId)
      if ((await popRepository.countFibersForOlt(oltId)) > 0) {
        throw ApiError.conflict('Fibers are assigned to this OLT')
      }
      await popRepository.deleteOlt(oltId)
    },
  }
}

export const popService = createPopService({
  popRepository,
  fiberPointRepository,
  zoneRepository,
  userRepository,
  storage: getStorageProvider(),
  prisma,
})
