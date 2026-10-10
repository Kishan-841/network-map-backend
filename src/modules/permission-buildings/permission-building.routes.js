import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import {
  listQuerySchema,
  visitSchema,
  approveSchema,
  rejectSchema,
  surveySchema,
  noteSchema,
} from './permission-building.schemas.js'
import { zoneRepository } from '../zones/zone.repository.js'
import { permissionBuildingRepository } from './permission-building.repository.js'
import { createPermissionBuildingService } from './permission-building.service.js'

const service = createPermissionBuildingService({
  repo: permissionBuildingRepository,
  storage: getStorageProvider(),
  zoneRepository,
})

const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) })
  } catch (err) {
    next(err)
  }
}

export const permissionBuildingRoutes = Router()
// Phase 3: SURVEYOR and MANAGER (approved societies in their zones) and
// SUPERVISOR (every approved society) read too; the service scopes every row (404 outside).
permissionBuildingRoutes.use(
  requireAuth,
  requireRole('PERMISSION_EXECUTIVE', 'ADMIN', 'SURVEYOR', 'MANAGER', 'SUPERVISOR'),
)

permissionBuildingRoutes.get(
  '/',
  validateQuery(listQuerySchema),
  handle((req) => service.list(req.validatedQuery ?? {}, req.user)),
)
// Above /:id — 'pending-count' is not an id.
permissionBuildingRoutes.get(
  '/pending-count',
  requireRole('ADMIN'),
  handle(() => service.pendingCount()),
)
// Above /:id too.
permissionBuildingRoutes.get(
  '/survey-pending-count',
  requireRole('ADMIN'),
  handle(() => service.surveyPendingCount()),
)
permissionBuildingRoutes.get('/survey-catalogue', handle(() => service.catalogue()))
permissionBuildingRoutes.get('/:id', handle((req) => service.get(req.params.id, req.user)))
permissionBuildingRoutes.post(
  '/:id/visits',
  // Visit updates stay the executive's (and the admin's).
  requireRole('PERMISSION_EXECUTIVE', 'ADMIN'),
  // module 'Building' so the log row carries the building id like other building events.
  audit('Building', 'PermissionVisit', {
    describe: (req, old, body) =>
      body?.data?.visit?.statusAfter
        ? `Society visit update: ${body.data.visit.statusBefore ?? 'none'} → ${body.data.visit.statusAfter}`
        : 'Society visit update',
  }),
  validateBody(visitSchema),
  handle((req) => service.addVisit(req.params.id, req.body, req.user), 201),
)

// Phase 2 — ADMIN only. Each is one transaction under the building's row lock.
permissionBuildingRoutes.post(
  '/:id/approve',
  requireRole('ADMIN'),
  audit('Building', 'SocietyApprove', {
    describe: (req, old, body) =>
      `Society '${body?.data?.buildingName ?? req.params.id}' approved into zone ${body?.data?.zone?.name ?? req.body?.zoneId ?? ''}`.trim(),
  }),
  validateBody(approveSchema),
  handle((req) => service.approve(req.params.id, req.body, req.user)),
)
permissionBuildingRoutes.post(
  '/:id/reject',
  requireRole('ADMIN'),
  audit('Building', 'SocietyReject', {
    describe: (req, old, body) => `Society '${body?.data?.buildingName ?? req.params.id}' rejected: ${String(req.body?.reason ?? '').slice(0, 200)}`,
  }),
  validateBody(rejectSchema),
  handle((req) => service.reject(req.params.id, req.body, req.user)),
)

// Phase 3 — site survey + material request, and the surveyor's "mark live".
// Writes run under the building's row lock with their history row.
permissionBuildingRoutes.get('/:id/survey', handle((req) => service.getSurvey(req.params.id, req.user)))
permissionBuildingRoutes.put(
  '/:id/survey',
  audit('Building', 'SocietySurveySave', {
    describe: (req, old, body) => `Society survey saved (${body?.data?.status ?? 'failed'})`,
  }),
  validateBody(surveySchema),
  handle((req) => service.saveSurvey(req.params.id, req.body, req.user)),
)
permissionBuildingRoutes.post(
  '/:id/survey/submit',
  audit('Building', 'SocietySurveySubmit', { describe: () => 'Society survey submitted for material approval' }),
  validateBody(noteSchema),
  handle((req) => service.submitSurvey(req.params.id, req.body, req.user)),
)
permissionBuildingRoutes.post(
  '/:id/survey/approve',
  requireRole('ADMIN'),
  audit('Building', 'SocietyMaterialsApprove', { describe: () => 'Society materials approved' }),
  validateBody(noteSchema),
  handle((req) => service.approveMaterials(req.params.id, req.body, req.user)),
)
permissionBuildingRoutes.post(
  '/:id/survey/reject',
  requireRole('ADMIN'),
  audit('Building', 'SocietyMaterialsReject', {
    describe: (req) => `Society materials rejected: ${String(req.body?.reason ?? '').slice(0, 200)}`,
  }),
  validateBody(rejectSchema),
  handle((req) => service.rejectMaterials(req.params.id, req.body, req.user)),
)
permissionBuildingRoutes.post(
  '/:id/mark-live',
  audit('Building', 'MarkLive', {
    describe: (req, old, body) => `Society '${body?.data?.buildingName ?? req.params.id}' marked live`,
  }),
  validateBody(noteSchema),
  handle((req) => service.markLive(req.params.id, req.body, req.user)),
)
