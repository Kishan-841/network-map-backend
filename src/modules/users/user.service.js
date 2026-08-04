import bcrypt from 'bcryptjs'
import { ApiError } from '../../lib/api-error.js'
import { toPublicUser } from '../auth/auth.service.js'

const BCRYPT_ROUNDS = 10

export function createUserService({ userRepository, zoneRepository }) {
  // zoneIds -> Prisma relation op, or undefined when not applicable
  // (assignments are stored only for surveyors).
  async function zoneAssignment(zoneIds, role, op) {
    if (zoneIds === undefined || role !== 'SURVEYOR') return undefined
    const found = await zoneRepository.countByIds(zoneIds)
    if (found !== zoneIds.length) throw ApiError.badRequest('One or more zones do not exist')
    return { [op]: zoneIds.map((id) => ({ id })) }
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

    async updateUser(id, { password, email, zoneIds, ...data }) {
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
        const current = await userRepository.findById(id)
        if (!current) throw ApiError.notFound('User not found')
        const targetRole = data.role ?? current.role
        const assignedZones = await zoneAssignment(zoneIds, targetRole, 'set')
        if (assignedZones) data.assignedZones = assignedZones
      }

      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },
  }
}
