import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  bulkZoneAssignSchema,
  userAccessSchema,
} from './user.schemas.js'
import { userController } from './user.controller.js'
import { audit } from '../system-logs/audit.js'
import { userRepository } from './user.repository.js'

export const userRoutes = Router()

userRoutes.use(requireAuth)
userRoutes.post(
  '/',
  requireRole('ADMIN', 'ACQUISITION_LEAD'),
  audit('User', 'Create', {
    describe: (req) => `User '${req.body?.email ?? 'unknown'}' created`,
  }),
  validateBody(createUserSchema),
  userController.create,
)
userRoutes.post(
  '/bulk-zones',
  requireRole('ADMIN'),
  audit('User', 'BulkZoneAssign', {
    describe: (req, old, body) =>
      body?.data
        ? `Bulk zone assignment: ${body.data.updated.length} updated, ${body.data.skipped.length} skipped`
        : 'Bulk zone assignment',
  }),
  validateBody(bulkZoneAssignSchema),
  userController.bulkZones,
)
userRoutes.get(
  '/',
  requireRole('ADMIN', 'MANAGER', 'ACQUISITION_LEAD'),
  validateQuery(listUsersQuerySchema),
  userController.list,
)
userRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'ACQUISITION_LEAD'),
  audit('User', 'Update', {
    load: (req) => userRepository.findById(req.params.id),
    describe: (req, old) => `User '${old?.email ?? req.params.id}' updated`,
  }),
  validateBody(updateUserSchema),
  userController.update,
)
userRoutes.patch(
  '/:id/access',
  requireRole('ADMIN'),
  audit('User', 'AccessChange', {
    load: (req) => userRepository.findById(req.params.id),
    describe: (req, old) => {
      const who = old?.email ?? req.params.id
      const said = (key, label) =>
        req.body?.[key] === undefined
          ? null
          : `${label} ${req.body[key] === true ? 'given to' : 'removed from'} '${who}'`
      return (
        [said('canManageFiber', 'Fiber access'), said('canEditBuildings', 'Building editing')]
          .filter(Boolean)
          .join('; ') || `Access changed for '${who}'`
      )
    },
  }),
  validateBody(userAccessSchema),
  userController.setAccess,
)
