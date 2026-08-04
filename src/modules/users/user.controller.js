import { createUserService } from './user.service.js'
import { userRepository } from './user.repository.js'
import { zoneRepository } from '../zones/zone.repository.js'

const userService = createUserService({ userRepository, zoneRepository })

export const userController = {
  async create(req, res, next) {
    try {
      const user = await userService.createUser(req.body)
      res.status(201).json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  },

  async list(req, res, next) {
    try {
      const query = req.validatedQuery ?? {}
      // Dual response: ?page → envelope; without → legacy array (dropdown consumers).
      const data = query.page ? await userService.listUsersPaged(query) : await userService.listUsers()
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async bulkZones(req, res, next) {
    try {
      const result = await userService.bulkAssignZones(req.body.assignments)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      const user = await userService.updateUser(req.params.id, req.body)
      res.json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  },
}
