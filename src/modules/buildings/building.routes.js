import { Router } from 'express'
import { requireAuth, requireRole, requireBuildingEdit, requireOltAssign } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  createBuildingSchema,
  nearbyQuerySchema,
  listQuerySchema,
  addPhotoSchema,
  updateStatusSchema,
  updateBuildingSchema,
  bulkBuildingsSchema,
  bulkStatusSchema,
  bulkDeleteSchema,
  bulkOltSchema,
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
buildingRoutes.post(
  '/bulk',
  requireRole('ADMIN'),
  audit('Building', 'BulkCreate', {
    describe: (req, old, body) =>
      body?.data
        ? `Bulk building import: ${body.data.createdCount} created, ${body.data.skipped.length} skipped`
        : 'Bulk building import',
  }),
  validateBody(bulkBuildingsSchema),
  buildingController.bulk,
)
// Bulk go-live. Above /:id routes so 'bulk-status' is never read as an id.
buildingRoutes.patch(
  '/bulk-status',
  requireRole('ADMIN', 'MANAGER', 'SUPERVISOR'),
  audit('Building', 'BulkStatusChange', {
    describe: (req, old, body) =>
      body?.data
        ? `${body.data.count} building(s) marked ${body.data.isLive ? 'live' : 'not live'}`
        : 'Bulk status change',
  }),
  validateBody(bulkStatusSchema),
  buildingController.bulkStatus,
)
// Bulk delete of the ticked rows. Above /:id so 'bulk-delete' is not read as an id.
buildingRoutes.post(
  '/bulk-delete',
  requireRole('ADMIN'),
  audit('Building', 'BulkDelete', {
    describe: (req, old, body) =>
      body?.data
        ? `${body.data.deletedCount} building(s) deleted, ${body.data.skipped.length} skipped`
        : 'Bulk building delete',
  }),
  validateBody(bulkDeleteSchema),
  buildingController.bulkDelete,
)
// Bulk OLT + PON mapping of the ticked buildings. Above /:id. Open to every
// coverage role (a surveyor needs no edit tick); the service keeps it zone-safe.
buildingRoutes.patch(
  '/bulk-olt',
  requireOltAssign,
  audit('Building', 'BulkOltMap', {
    describe: (req, old, body) =>
      body?.data
        ? `${body.data.count} building(s) mapped to an OLT on PON port ${body.data.ponPort}`
        : 'Bulk OLT mapping',
  }),
  validateBody(bulkOltSchema),
  buildingController.bulkAssignOlt,
)
buildingRoutes.get('/', validateQuery(listQuerySchema), buildingController.list)
// Above /:id, or Express reads 'export' as a building id.
buildingRoutes.get(
  '/export',
  requireRole('ADMIN'),
  audit('Building', 'Export', {
    describe: (req) =>
      `Exported the building list${
        Object.keys(req.query ?? {}).length ? ` (filtered: ${new URLSearchParams(req.query)})` : ''
      }`,
  }),
  validateQuery(listQuerySchema),
  buildingController.exportXlsx,
)
// Above /:id, like /export and /nearby — 'markers' is not a building id.
// The map's own feed: every building in scope, lean fields, no pagination.
buildingRoutes.get('/markers', validateQuery(listQuerySchema), buildingController.markers)
// NOTE: /nearby must stay above /:id or Express matches it as an id.
buildingRoutes.get('/nearby', validateQuery(nearbyQuerySchema), buildingController.nearby)
buildingRoutes.get('/:id', buildingController.get)
buildingRoutes.patch(
  '/:id/status',
  requireRole('ADMIN', 'MANAGER', 'SUPERVISOR'),
  audit('Building', 'StatusChange', {
    load: (req) => buildingRepository.findById(req.params.id),
    describe: (req, old) => `Building '${old?.buildingName ?? req.params.id}' status changed`,
  }),
  validateBody(updateStatusSchema),
  buildingController.updateStatus,
)
buildingRoutes.patch(
  '/:id',
  requireBuildingEdit,
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
buildingRoutes.delete(
  '/:id',
  requireRole('ADMIN'),
  audit('Building', 'Delete', {
    load: (req) => buildingRepository.findById(req.params.id),
    describe: (req, old) => `Building '${old?.buildingName ?? req.params.id}' deleted`,
  }),
  buildingController.remove,
)
