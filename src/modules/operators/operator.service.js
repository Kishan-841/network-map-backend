import { ApiError } from '../../lib/api-error.js'
import { operatorRepository } from './operator.repository.js'
import { zoneRepository } from '../zones/zone.repository.js'
import { userRepository } from '../users/user.repository.js'

export function createOperatorService(deps) {
  const { operatorRepository, zoneRepository, userRepository } = deps

  return {
    async listOperators() {
      return operatorRepository.list()
    },

    async listOperatorsPaged({ page, pageSize, search }) {
      const where = search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}
      const [items, total] = await Promise.all([
        operatorRepository.paged({ where, skip: (page - 1) * pageSize, take: pageSize }),
        operatorRepository.count(where),
      ])
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    },

    async createOperator(data) {
      const existing = await operatorRepository.findByName(data.name)
      if (existing) throw ApiError.conflict('An operator with this name already exists')
      return operatorRepository.create(data)
    },

    async updateOperator(id, data) {
      const operator = await operatorRepository.findById(id)
      if (!operator) throw ApiError.notFound('Operator not found')
      return operatorRepository.update(id, data)
    },

    async deleteOperator(id) {
      const operator = await operatorRepository.findById(id)
      if (!operator) throw ApiError.notFound('Operator not found')
      // Detach zones (SetNull handles the FK, but be explicit) then delete.
      await zoneRepository.clearOperator(id)
      await operatorRepository.delete(id)
    },

    /**
     * One upload that (1) creates missing operators, (2) creates/links zones to
     * their operator, (3) assigns each surveyor (by email) the union of their
     * sheet zones (replace). Existing operators/zones are reused.
     */
    async importOperatorMapping(rows) {
      const operators = await operatorRepository.listAll()
      const opIdByName = new Map(operators.map((op) => [op.name.trim().toLowerCase(), op.id]))
      const zones = await zoneRepository.listAll()
      const zoneByName = new Map(zones.map((z) => [z.name.trim().toLowerCase(), z]))

      let operatorsCreated = 0
      let zonesCreated = 0
      let zonesLinked = 0
      const emailToZoneIds = new Map()

      for (const { operator, zone, city, email } of rows) {
        // 1. Operator
        const opKey = operator.trim().toLowerCase()
        let operatorId = opIdByName.get(opKey)
        if (!operatorId) {
          const created = await operatorRepository.create({ name: operator.trim(), city: city || null })
          operatorId = created.id
          opIdByName.set(opKey, operatorId)
          operatorsCreated++
        }

        // 2. Zone
        const zoneKey = zone.trim().toLowerCase()
        let zoneRecord = zoneByName.get(zoneKey)
        if (!zoneRecord) {
          zoneRecord = await zoneRepository.create({
            name: zone.trim(),
            city: city || 'Unknown',
            operatorId,
          })
          zoneByName.set(zoneKey, zoneRecord)
          zonesCreated++
        } else if (zoneRecord.operatorId !== operatorId) {
          await zoneRepository.update(zoneRecord.id, { operatorId })
          zoneRecord.operatorId = operatorId
          zonesLinked++
        }

        // 3. Group email → zone ids (union)
        const emailKey = email.trim().toLowerCase()
        if (!emailToZoneIds.has(emailKey)) emailToZoneIds.set(emailKey, new Set())
        emailToZoneIds.get(emailKey).add(zoneRecord.id)
      }

      const surveyorsUpdated = []
      const skipped = []
      for (const [email, zoneIdSet] of emailToZoneIds) {
        const user = await userRepository.findByEmailInsensitive(email)
        if (!user) {
          skipped.push({ email, reason: 'user not found' })
          continue
        }
        if (user.role !== 'SURVEYOR') {
          skipped.push({ email, reason: 'not a surveyor' })
          continue
        }
        const ids = [...zoneIdSet]
        await userRepository.update(user.id, {
          assignedZones: { set: ids.map((id) => ({ id })) },
        })
        surveyorsUpdated.push({ email: user.email, zones: ids.length })
      }

      return {
        operatorsCreated,
        zonesCreated,
        zonesLinked,
        surveyorsUpdated,
        skipped,
        totalRows: rows.length,
      }
    },
  }
}

export const operatorService = createOperatorService({
  operatorRepository,
  zoneRepository,
  userRepository,
})
