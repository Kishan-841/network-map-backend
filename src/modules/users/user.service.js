import bcrypt from 'bcryptjs'
import { ApiError } from '../../lib/api-error.js'
import { toPublicUser } from '../auth/auth.service.js'

const BCRYPT_ROUNDS = 10

export function createUserService({ userRepository, zoneRepository }) {
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
    async createUser({ password, zoneIds, ...data }) {
      const existing = await userRepository.findByEmail(data.email)
      if (existing) throw ApiError.conflict('A user with this email already exists')

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const assignedZones = await zoneAssignment(zoneIds, data.role, 'connect')
      const user = await userRepository.create({
        ...data,
        passwordHash,
        ...(assignedZones && { assignedZones }),
      })
      return toPublicUser(user)
    },

    async listUsers() {
      const users = await userRepository.list()
      return users.map(toPublicUser)
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

    async listUsersPaged({ page, pageSize, search, role }) {
      const where = {
        ...(role && { role }),
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

    async updateUser(id, { password, email, zoneIds, ...data }) {
      // Explicit existence check → 404 instead of a Prisma P2025 leaking as 500.
      const current = await userRepository.findById(id)
      if (!current) throw ApiError.notFound('User not found')
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

      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },
  }
}
