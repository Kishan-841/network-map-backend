import { Router } from 'express'
import { requireAuth, requireRole, requireFiberWrite } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { popRepository } from './pop.repository.js'
import { createPopSchema, updatePopSchema, createOltSchema, updateOltSchema } from './pop.schemas.js'
import { popController } from './pop.controller.js'

export const popRoutes = Router()

popRoutes.use(requireAuth)
const READ = requireRole('ADMIN', 'MANAGER', 'SURVEYOR', 'SUPERVISOR')
// POPs are part of building the fiber network, so they follow the same
// per-user grant as fibers and closures rather than a role of their own.
const WRITE = requireFiberWrite

popRoutes.get('/', READ, popController.list)
popRoutes.post(
  '/',
  WRITE,
  audit('Pop', 'Create', {
    describe: (req) => `POP '${req.body?.name ?? 'unknown'}' created`,
  }),
  validateBody(createPopSchema),
  popController.create,
)
popRoutes.patch(
  '/:id',
  WRITE,
  audit('Pop', 'Update', {
    load: (req) => popRepository.findById(req.params.id),
    describe: (req, old) => `POP '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updatePopSchema),
  popController.update,
)
popRoutes.delete(
  '/:id',
  WRITE,
  audit('Pop', 'Delete', {
    load: (req) => popRepository.findById(req.params.id),
    describe: (req, old) => `POP '${old?.name ?? req.params.id}' deleted`,
  }),
  popController.remove,
)
popRoutes.post(
  '/:id/olts',
  WRITE,
  audit('Pop', 'OltCreate', {
    recordId: (req) => req.params.id,
    describe: (req) => `OLT '${req.body?.name}' added`,
  }),
  validateBody(createOltSchema),
  popController.createOlt,
)
popRoutes.patch(
  '/:id/olts/:oltId',
  WRITE,
  audit('Pop', 'OltUpdate', { recordId: (req) => req.params.id }),
  validateBody(updateOltSchema),
  popController.updateOlt,
)
popRoutes.delete(
  '/:id/olts/:oltId',
  WRITE,
  audit('Pop', 'OltDelete', { recordId: (req) => req.params.id }),
  popController.deleteOlt,
)
