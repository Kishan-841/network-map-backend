import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { cityRepository } from './city.repository.js'
import { createCitySchema, updateCitySchema } from './city.schemas.js'
import { cityController } from './city.controller.js'

export const cityRoutes = Router()

cityRoutes.use(requireAuth)
cityRoutes.get('/', requireRole('ADMIN', 'MANAGER'), cityController.list)
cityRoutes.post(
  '/',
  requireRole('ADMIN'),
  audit('City', 'Create', {
    describe: (req) => `City '${req.body?.name ?? 'unknown'}' created`,
  }),
  validateBody(createCitySchema),
  cityController.create,
)
cityRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  audit('City', 'Update', {
    load: (req) => cityRepository.findById(req.params.id),
    describe: (req, old) => `City '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateCitySchema),
  cityController.update,
)
cityRoutes.delete(
  '/:id',
  requireRole('ADMIN'),
  audit('City', 'Delete', {
    load: (req) => cityRepository.findById(req.params.id),
    describe: (req, old) => `City '${old?.name ?? req.params.id}' deleted`,
  }),
  cityController.remove,
)
