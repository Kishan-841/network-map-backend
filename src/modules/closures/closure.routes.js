import { Router } from 'express'
import { requireAuth, requireRole, requireFiberWrite } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { closureRepository } from './closure.repository.js'
import { createClosureSchema, updateClosureSchema, createSplitterSchema } from './closure.schemas.js'
import { closureController } from './closure.controller.js'

export const closureRoutes = Router()

closureRoutes.use(requireAuth)
const READ = requireRole('ADMIN', 'MANAGER', 'SURVEYOR', 'SUPERVISOR')
const WRITE = requireFiberWrite

closureRoutes.get('/', READ, closureController.list)
closureRoutes.get('/:id', READ, closureController.get)
closureRoutes.post(
  '/',
  WRITE,
  audit('Closure', 'Create', {
    describe: (req, old, body) => `Closure '${body?.data?.code ?? 'unknown'}' created`,
  }),
  validateBody(createClosureSchema),
  closureController.create,
)
closureRoutes.patch(
  '/:id',
  WRITE,
  audit('Closure', 'Update', {
    load: (req) => closureRepository.findById(req.params.id),
    describe: (req, old) => `Closure '${old?.code ?? req.params.id}' updated`,
  }),
  validateBody(updateClosureSchema),
  closureController.update,
)
closureRoutes.delete(
  '/:id',
  WRITE,
  audit('Closure', 'Delete', {
    load: (req) => closureRepository.findById(req.params.id),
    describe: (req, old) => `Closure '${old?.code ?? req.params.id}' deleted`,
  }),
  closureController.remove,
)
closureRoutes.post(
  '/:id/splitters',
  WRITE,
  audit('Closure', 'SplitterAdd', {
    recordId: (req) => req.params.id,
    describe: (req) => `Splitter '${req.body?.ratio ?? 'unknown'}' added`,
  }),
  validateBody(createSplitterSchema),
  closureController.addSplitter,
)
