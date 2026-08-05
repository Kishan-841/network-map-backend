import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { operatorRepository } from './operator.repository.js'
import {
  createOperatorSchema,
  updateOperatorSchema,
  listOperatorsQuerySchema,
  operatorImportSchema,
} from './operator.schemas.js'
import { operatorController } from './operator.controller.js'

export const operatorRoutes = Router()

operatorRoutes.use(requireAuth)
operatorRoutes.get(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validateQuery(listOperatorsQuerySchema),
  operatorController.list,
)
operatorRoutes.post(
  '/import',
  requireRole('ADMIN'),
  audit('Operator', 'MappingImport', {
    describe: (req, old, body) =>
      body?.data
        ? `Operator mapping: ${body.data.operatorsCreated} operators, ${body.data.zonesCreated} zones, ${body.data.surveyorsUpdated.length} surveyors`
        : 'Operator mapping import',
  }),
  validateBody(operatorImportSchema),
  operatorController.import,
)
operatorRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  audit('Operator', 'Create', {
    describe: (req) => `Operator '${req.body?.name ?? 'unknown'}' created`,
  }),
  validateBody(createOperatorSchema),
  operatorController.create,
)
operatorRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('Operator', 'Update', {
    load: (req) => operatorRepository.findById(req.params.id),
    describe: (req, old) => `Operator '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateOperatorSchema),
  operatorController.update,
)
operatorRoutes.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('Operator', 'Delete', {
    load: (req) => operatorRepository.findById(req.params.id),
    describe: (req, old) => `Operator '${old?.name ?? req.params.id}' deleted`,
  }),
  operatorController.remove,
)
