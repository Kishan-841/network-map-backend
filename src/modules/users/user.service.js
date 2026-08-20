import bcrypt from 'bcryptjs'
import { ApiError } from '../../lib/api-error.js'
import { toPublicUser } from '../auth/auth.service.js'

const BCRYPT_ROUNDS = 10

export function createUserService({ userRepository, zoneRepository, cityRepository }) {
  // Acquisition agents cover one city + a set of pincodes. Stored as rows so
  // an agent can hold several pincodes and the mapping stays queryable.
  async function pincodeAssignment({ cityId, pincodes, role, userId }) {
    if (role !== 'ACQUISITION_AGENT' || pincodes === undefined) return null
    if (pincodes.length > 0 && !cityId) {
      throw ApiError.badRequest('Select a city for the agent\'s pincodes')
    }
    if (cityId) {
      const city = await cityRepository.findById(cityId)
      if (!city) throw ApiError.badRequest('City does not exist')
    }
    const unique = [...new Set(pincodes)]
    return { cityId, pincodes: unique, userId }
  }

  // Leads run the acquisition team only — they must never create or touch
  // admins, managers or coverage surveyors.
  function assertMayManage(actor, targetRole) {
    if (actor?.role !== 'ACQUISITION_LEAD') return
    if (targetRole !== 'ACQUISITION_AGENT') {
      throw ApiError.forbidden('Acquisition leads can only manage acquisition agents')
    }
  }

  // zoneIds -> Prisma relation op, or undefined when not applicable
  // (assignments are stored only for surveyors).
  async function zoneAssignment(zoneIds, role, op) {
    if (zoneIds === undefined || role !== 'SURVEYOR') return undefined
    // Dedupe first: countByIds is a distinct-row count, so a repeated id
    // (UI double-click / merged sheet) would otherwise fail the length check.
    const uniqueIds = [...new Set(zoneIds)]
    const found = await zoneRepository.countByIds(uniqueIds)
    if (found !== uniqueIds.length) throw ApiError.badRequest('One or more zones do not exist')
    return { [op]: uniqueIds.map((id) => ({ id })) }
  }

  return {
    async createUser({ password, zoneIds, cityId, pincodes, ...data }, actor) {
      assertMayManage(actor, data.role)
      const existing = await userRepository.findByEmail(data.email)
      if (existing) throw ApiError.conflict('A user with this email already exists')

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const assignedZones = await zoneAssignment(zoneIds, data.role, 'connect')
      const pin = await pincodeAssignment({ cityId, pincodes, role: data.role })
      const user = await userRepository.create({
        ...data,
        passwordHash,
        ...(assignedZones && { assignedZones }),
        ...(pin && {
          pincodes: {
            create: pin.pincodes.map((pincode) => ({ pincode, cityId: pin.cityId })),
          },
        }),
      })
      return toPublicUser(user)
    },

    async listUsers(actor) {
      const users = await userRepository.list()
      const scoped =
        actor?.role === 'ACQUISITION_LEAD'
          ? users.filter((u) => u.role === 'ACQUISITION_AGENT')
          : users
      return scoped.map(toPublicUser)
    },

    // Sheet-driven assignment: each row REPLACES that surveyor's zone set.
    // Rows with any unresolvable zone name are skipped whole — a typo must
    // never silently shrink an assignment.
    async bulkAssignZones(assignments) {
      const zones = await zoneRepository.list()
      const zoneIdByName = new Map(zones.map((zone) => [zone.name.trim().toLowerCase(), zone.id]))

      const updated = []
      const skipped = []
      for (const { email, zoneNames } of assignments) {
        const user = await userRepository.findByEmailInsensitive(email.trim())
        if (!user) {
          skipped.push({ email, reason: 'user not found' })
          continue
        }
        if (user.role !== 'SURVEYOR') {
          skipped.push({ email, reason: 'not a surveyor' })
          continue
        }
        const missing = zoneNames.filter(
          (name) => !zoneIdByName.has(name.trim().toLowerCase()),
        )
        if (missing.length > 0) {
          skipped.push({ email, reason: `zone(s) not found: ${missing.join(', ')}` })
          continue
        }
        const ids = [...new Set(zoneNames.map((name) => zoneIdByName.get(name.trim().toLowerCase())))]
        await userRepository.update(user.id, {
          assignedZones: { set: ids.map((id) => ({ id })) },
        })
        updated.push({ email: user.email, zones: ids.length })
      }
      return { updated, skipped, total: assignments.length }
    },

    async listUsersPaged({ page, pageSize, search, role }, actor) {
      const where = {
        // A lead's directory is their own team, nobody else.
        ...(actor?.role === 'ACQUISITION_LEAD' ? { role: 'ACQUISITION_AGENT' } : role && { role }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      }
      const [items, total] = await Promise.all([
        userRepository.paged({ where, skip: (page - 1) * pageSize, take: pageSize }),
        userRepository.count(where),
      ])
      return {
        items: items.map(toPublicUser),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }
    },

    async updateUser(id, { password, email, zoneIds, cityId, pincodes, ...data }, actor) {
      // Explicit existence check → 404 instead of a Prisma P2025 leaking as 500.
      const current = await userRepository.findById(id)
      if (!current) throw ApiError.notFound('User not found')
      // A lead may edit agents only, and may not promote one out of the team.
      assertMayManage(actor, current.role)
      if (data.role) assertMayManage(actor, data.role)
      // Changing to an email another account already uses → clean 409.
      if (email) {
        const existing = await userRepository.findByEmail(email)
        if (existing && existing.id !== id) {
          throw ApiError.conflict('A user with this email already exists')
        }
        data.email = email
      }
      // Password is stored only as a hash, never plaintext.
      if (password) data.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      // zoneIds replaces the full assignment set; omitting it leaves it unchanged.
      if (zoneIds !== undefined) {
        const targetRole = data.role ?? current.role
        const assignedZones = await zoneAssignment(zoneIds, targetRole, 'set')
        if (assignedZones) data.assignedZones = assignedZones
      }

      // pincodes replaces the agent's full set; omitting it leaves it as-is.
      const targetRoleForPin = data.role ?? current.role
      const pin = await pincodeAssignment({
        cityId: cityId === undefined ? current.pincodes?.[0]?.cityId : cityId,
        pincodes,
        role: targetRoleForPin,
      })
      if (pin) {
        data.pincodes = {
          deleteMany: {},
          create: pin.pincodes.map((pincode) => ({ pincode, cityId: pin.cityId })),
        }
      }

      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },
  }
}
