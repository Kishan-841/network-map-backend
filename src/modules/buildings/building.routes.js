import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  createBuildingSchema,
  nearbyQuerySchema,
  listQuerySchema,
  addPhotoSchema,
  updateStatusSchema,
  updateBuildingSchema,
} from './building.schemas.js'
import { buildingController } from './building.controller.js'
import { audit } from '../system-logs/audit.js'
import { buildingRepository } from './building.repository.js'

export const buildingRoutes = Router()

buildingRoutes.use(requireAuth)
buildingRoutes.post(
  '/',
  audit('Building', 'Create', {
    describe: (req) => `Building '${req.body?.buildingName ?? 'unknown'}' added`,
  }),
  validateBody(createBuildingSchema),
  buildingController.create,
)
buildingRoutes.get('/', validateQuery(listQuerySchema), buildingController.list)
// NOTE: /nearby must stay above /:id or Express matches it as an id.
buildingRoutes.get('/nearby', validateQuery(nearbyQuerySchema), buildingController.nearby)
buildingRoutes.get('/:id', buildingController.get)
buildingRoutes.patch(
  '/:id/status',
  requireRole('ADMIN', 'MANAGER'),
  audit('Building', 'StatusChange', {
    load: (req) => buildingRepository.findById(req.params.id),
    describe: (req, old) => `Building '${old?.buildingName ?? req.params.id}' status changed`,
  }),
  validateBody(updateStatusSchema),
  buildingController.updateStatus,
)
buildingRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('Building', 'Update', {
    load: (req) => buildingRepository.findById(req.params.id),
    describe: (req, old) => `Building '${old?.buildingName ?? req.params.id}' updated`,
  }),
  validateBody(updateBuildingSchema),
  buildingController.update,
)
buildingRoutes.post(
  '/:id/photos',
  audit('Building', 'PhotoAdd', {
    describe: (req) => `Photo added to building ${req.params.id}`,
  }),
  validateBody(addPhotoSchema),
  buildingController.addPhoto,
)
buildingRoutes.delete(
  '/:id/photos/:photoId',
  // Ownership is enforced in the service so surveyors can fix their own photos.
  audit('Building', 'PhotoDelete', {
    describe: (req) => `Photo ${req.params.photoId} deleted from building ${req.params.id}`,
    recordId: (req) => req.params.photoId,
    buildingId: (req) => req.params.id,
  }),
  buildingController.removePhoto,
)
