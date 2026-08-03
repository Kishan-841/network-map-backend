import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { createUserSchema, updateUserSchema } from './user.schemas.js'
import { userController } from './user.controller.js'
import { audit } from '../system-logs/audit.js'
import { userRepository } from './user.repository.js'

export const userRoutes = Router()

userRoutes.use(requireAuth)
userRoutes.post(
  '/',
  requireRole('ADMIN'),
  audit('User', 'Create', {
    describe: (req) => `User '${req.body?.email ?? 'unknown'}' created`,
  }),
  validateBody(createUserSchema),
  userController.create,
)
userRoutes.get('/', requireRole('ADMIN', 'MANAGER'), userController.list)
userRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  audit('User', 'Update', {
    load: (req) => userRepository.findById(req.params.id),
    describe: (req, old) => `User '${old?.email ?? req.params.id}' updated`,
  }),
  validateBody(updateUserSchema),
  userController.update,
)
