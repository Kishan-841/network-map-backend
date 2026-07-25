import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { createUserSchema, updateUserSchema } from './user.schemas.js'
import { userController } from './user.controller.js'

export const userRoutes = Router()

userRoutes.use(requireAuth)
userRoutes.post('/', requireRole('ADMIN'), validateBody(createUserSchema), userController.create)
userRoutes.get('/', requireRole('ADMIN', 'MANAGER'), userController.list)
userRoutes.patch('/:id', requireRole('ADMIN'), validateBody(updateUserSchema), userController.update)
