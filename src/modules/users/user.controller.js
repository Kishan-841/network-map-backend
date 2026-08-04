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
      const users = await userService.listUsers()
      res.json({ success: true, data: users })
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
