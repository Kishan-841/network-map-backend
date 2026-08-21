import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { fiberRouteRepository } from './fiber-route.repository.js'
import { createFiberRouteSchema, updateFiberRouteSchema } from './fiber-route.schemas.js'
import { fiberRouteController } from './fiber-route.controller.js'

export const fiberRouteRoutes = Router()

fiberRouteRoutes.use(requireAuth)
// Coverage-only: the physical fiber layout is not acquisition-team data.
fiberRouteRoutes.get('/', requireRole('ADMIN', 'MANAGER', 'SURVEYOR'), fiberRouteController.list)
fiberRouteRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  audit('FiberRoute', 'Create', {
    describe: (req) => `Fiber route '${req.body?.name ?? 'unknown'}' created`,
  }),
  validateBody(createFiberRouteSchema),
  fiberRouteController.create,
)
fiberRouteRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('FiberRoute', 'Update', {
    load: (req) => fiberRouteRepository.findById(req.params.id),
    describe: (req, old) => `Fiber route '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateFiberRouteSchema),
  fiberRouteController.update,
)
fiberRouteRoutes.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('FiberRoute', 'Delete', {
    load: (req) => fiberRouteRepository.findById(req.params.id),
    describe: (req, old) => `Fiber route '${old?.name ?? req.params.id}' deleted`,
  }),
  fiberRouteController.remove,
)
