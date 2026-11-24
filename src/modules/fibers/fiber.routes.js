import { Router } from 'express'
import { requireAuth, requireRole, requireFiberWrite } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { findFibersNear, nearbyQuerySchema } from './fiber-nearby.js'
import { audit } from '../system-logs/audit.js'
import { fiberRepository } from './fiber.repository.js'
import {
  createFiberSchema,
  updateFiberSchema,
  segmentLaidSchema,
  cutSchema,
} from './fiber.schemas.js'
import { fiberController } from './fiber.controller.js'

export const fiberRoutes = Router()

fiberRoutes.use(requireAuth)
// Fibres are for the coverage team. A TEAM_LEADER sees their zones' POPs on
// the Sales map, but not the fibres (owner's call, 12 Oct).
const READ = requireRole('ADMIN', 'MANAGER', 'SURVEYOR', 'SUPERVISOR')
const WRITE = requireFiberWrite

fiberRoutes.get('/', READ, fiberController.list)
// A splitter's input fiber: near a pin, or by route name (24 Nov 2026). Before '/:id'.
fiberRoutes.get('/nearby', READ, validateQuery(nearbyQuerySchema), async (req, res, next) => {
  try {
    res.json({ success: true, data: await findFibersNear(req.validatedQuery, req.user) })
  } catch (err) {
    next(err)
  }
})
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
