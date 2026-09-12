import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { closureRepository } from './closure.repository.js'
import { updateSplitterSchema, setOutputSchema } from './closure.schemas.js'
import { splitterController } from './closure.controller.js'

export const splitterRoutes = Router()

splitterRoutes.use(requireAuth)
const WRITE = requireRole('ADMIN', 'MANAGER')

splitterRoutes.patch(
  '/:id',
  WRITE,
  audit('Splitter', 'Update', {
    load: (req) => closureRepository.findSplitterById(req.params.id),
    describe: (req, old) => `Splitter '${old?.id ?? req.params.id}' updated`,
  }),
  validateBody(updateSplitterSchema),
  splitterController.update,
)
splitterRoutes.delete(
  '/:id',
  WRITE,
  audit('Splitter', 'Delete', {
    load: (req) => closureRepository.findSplitterById(req.params.id),
    describe: (req, old) => `Splitter '${old?.id ?? req.params.id}' deleted`,
  }),
  splitterController.remove,
)
splitterRoutes.patch(
  '/:id/outputs/:portNo',
  WRITE,
  audit('Splitter', 'OutputUpdate', {
    recordId: (req) => req.params.id,
    describe: (req) => `Splitter '${req.params.id}' output ${req.params.portNo} updated`,
  }),
  validateBody(setOutputSchema),
  splitterController.setOutput,
)
