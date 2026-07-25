import bcrypt from 'bcryptjs'
import { ApiError } from '../../lib/api-error.js'
import { toPublicUser } from '../auth/auth.service.js'

const BCRYPT_ROUNDS = 10

export function createUserService({ userRepository }) {
  return {
    async createUser({ password, ...data }) {
      const existing = await userRepository.findByEmail(data.email)
      if (existing) throw ApiError.conflict('A user with this email already exists')

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const user = await userRepository.create({ ...data, passwordHash })
      return toPublicUser(user)
    },

    async listUsers() {
      const users = await userRepository.list()
      return users.map(toPublicUser)
    },

    async updateUser(id, data) {
      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },
  }
}
