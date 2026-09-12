import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { fiberRepository } from './fiber.repository.js'
import { createFiberSchema, updateFiberSchema, segmentLaidSchema, cutSchema } from './fiber.schemas.js'
import { fiberController } from './fiber.controller.js'

export const fiberRoutes = Router()

fiberRoutes.use(requireAuth)
const READ = requireRole('ADMIN', 'MANAGER', 'SURVEYOR', 'SUPERVISOR')
const WRITE = requireRole('ADMIN', 'MANAGER')

fiberRoutes.get('/', READ, fiberController.list)
fiberRoutes.get('/:id', READ, fiberController.get)
fiberRoutes.post(
  '/',
  WRITE,
  audit('Fiber', 'Create', {
    describe: (req, old, body) => `Fiber '${body?.data?.name ?? req.body?.name ?? 'auto'}' created`,
  }),
  validateBody(createFiberSchema),
  fiberController.create,
)
fiberRoutes.patch(
  '/:id',
  WRITE,
  audit('Fiber', 'Update', {
    load: (req) => fiberRepository.findById(req.params.id),
    describe: (req, old) => `Fiber '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateFiberSchema),
  fiberController.update,
)
fiberRoutes.patch(
  '/:id/segments/:segmentId',
  WRITE,
  audit('Fiber', 'SegmentUpdate', { recordId: (req) => req.params.id }),
  validateBody(segmentLaidSchema),
  fiberController.setSegmentLaid,
)
fiberRoutes.post(
  '/:id/cut',
  WRITE,
  audit('Fiber', 'Cut', {
    load: (req) => fiberRepository.findById(req.params.id),
    describe: (req, old) => `Fiber '${old?.name}' marked CUT`,
  }),
  validateBody(cutSchema),
  fiberController.cut,
)
fiberRoutes.post(
  '/:id/restore',
  WRITE,
  audit('Fiber', 'Restore', { load: (req) => fiberRepository.findById(req.params.id) }),
  fiberController.restore,
)
fiberRoutes.delete(
  '/:id',
  WRITE,
  audit('Fiber', 'Delete', {
    load: (req) => fiberRepository.findById(req.params.id),
    describe: (req, old) => `Fiber '${old?.name ?? req.params.id}' deleted`,
  }),
  fiberController.remove,
)
