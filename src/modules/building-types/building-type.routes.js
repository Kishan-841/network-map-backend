import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { buildingTypeSchema } from './building-type.schemas.js'
import { buildingTypeController } from './building-type.controller.js'
import { audit } from '../system-logs/audit.js'
import { buildingTypeRepository } from './building-type.repository.js'

export const buildingTypeRoutes = Router()

buildingTypeRoutes.use(requireAuth)
buildingTypeRoutes.get('/', buildingTypeController.list)
buildingTypeRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  audit('BuildingType', 'Create', {
    describe: (req) => `Building type '${req.body?.name ?? 'unknown'}' created`,
  }),
  validateBody(buildingTypeSchema),
  buildingTypeController.create,
)
buildingTypeRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('BuildingType', 'Update', {
    load: (req) => buildingTypeRepository.findById(req.params.id),
    describe: (req, old) =>
      `Building type '${old?.name ?? req.params.id}' renamed to '${req.body?.name ?? '?'}'`,
  }),
  validateBody(buildingTypeSchema),
  buildingTypeController.rename,
)
buildingTypeRoutes.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('BuildingType', 'Delete', {
    load: (req) => buildingTypeRepository.findById(req.params.id),
    describe: (req, old) => `Building type '${old?.name ?? req.params.id}' deleted`,
  }),
  buildingTypeController.remove,
)
