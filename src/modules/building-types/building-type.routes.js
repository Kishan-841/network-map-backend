import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { buildingTypeSchema } from './building-type.schemas.js'
import { buildingTypeController } from './building-type.controller.js'

export const buildingTypeRoutes = Router()

buildingTypeRoutes.use(requireAuth)
buildingTypeRoutes.get('/', buildingTypeController.list)
buildingTypeRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validateBody(buildingTypeSchema),
  buildingTypeController.create,
)
buildingTypeRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  validateBody(buildingTypeSchema),
  buildingTypeController.rename,
)
buildingTypeRoutes.delete('/:id', requireRole('ADMIN', 'MANAGER'), buildingTypeController.remove)
