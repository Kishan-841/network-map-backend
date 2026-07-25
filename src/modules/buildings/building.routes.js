import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  createBuildingSchema,
  nearbyQuerySchema,
  listQuerySchema,
  addPhotoSchema,
  updateStatusSchema,
} from './building.schemas.js'
import { buildingController } from './building.controller.js'

export const buildingRoutes = Router()

buildingRoutes.use(requireAuth)
buildingRoutes.post('/', validateBody(createBuildingSchema), buildingController.create)
buildingRoutes.get('/', validateQuery(listQuerySchema), buildingController.list)
// NOTE: /nearby must stay above /:id or Express matches it as an id.
buildingRoutes.get('/nearby', validateQuery(nearbyQuerySchema), buildingController.nearby)
buildingRoutes.get('/:id', buildingController.get)
buildingRoutes.patch(
  '/:id/status',
  requireRole('ADMIN', 'MANAGER'),
  validateBody(updateStatusSchema),
  buildingController.updateStatus,
)
buildingRoutes.post('/:id/photos', validateBody(addPhotoSchema), buildingController.addPhoto)
buildingRoutes.delete(
  '/:id/photos/:photoId',
  requireRole('ADMIN', 'MANAGER'),
  buildingController.removePhoto,
)
