import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  createCustomerSchema,
  importCustomersSchema,
  listAllQuerySchema,
  listQuerySchema,
  lookupSchema,
  updateCustomerSchema,
} from './customer.schemas.js'
import { customerController } from './customer.controller.js'
import { audit } from '../system-logs/audit.js'
import { customerRepository } from './customer.repository.js'

export const customerRoutes = Router()

// Every route needs a session; the writes below are ADMIN, the reads ride the
// building's own scope inside the service (out of scope → 404, never 403).
customerRoutes.use(requireAuth)

customerRoutes.get('/', validateQuery(listQuerySchema), customerController.list)

// Every customer in the actor's building scope (spec 2026-10-21). Before
// '/:id' so "list" is not read as a customer id.
customerRoutes.get('/list', validateQuery(listAllQuerySchema), customerController.listAll)
customerRoutes.get('/list.csv', validateQuery(listAllQuerySchema), customerController.exportCsv)

// Before '/:id' so "connections" is not read as a customer id.
customerRoutes.get('/connections', validateQuery(listQuerySchema), customerController.connections)

customerRoutes.get('/:id/connection', customerController.connection)

customerRoutes.get('/:id', customerController.get)

customerRoutes.post(
  '/building-lookup',
  requireRole('ADMIN'),
  validateBody(lookupSchema),
  customerController.lookup,
)

// The file can hold ~1k rows of personal data — log the outcome, not the rows.
const auditImport = audit('Customer', 'BulkImport', {
  describe: (req, old, body) => {
    const data = body?.data ?? {}
    return `Customer import: ${data.createdCount ?? 0} created, ${data.updatedCount ?? 0} updated, ${data.unchangedCount ?? 0} unchanged, ${data.skipped?.length ?? 0} skipped`
  },
  newValue: (req, body) => ({
    createdCount: body?.data?.createdCount ?? 0,
    updatedCount: body?.data?.updatedCount ?? 0,
    unchangedCount: body?.data?.unchangedCount ?? 0,
    skipped: body?.data?.skipped?.length ?? 0,
  }),
})

customerRoutes.post(
  '/import',
  requireRole('ADMIN'),
  // A dry run (the preview) changes nothing, so it leaves no log entry.
  (req, res, next) => (req.body?.dryRun === true ? next() : auditImport(req, res, next)),
  validateBody(importCustomersSchema),
  customerController.importRows,
)

customerRoutes.post(
  '/',
  requireRole('ADMIN'),
  audit('Customer', 'Create', {
    describe: (req) => `Customer '${req.body?.name ?? 'unknown'}' added`,
  }),
  validateBody(createCustomerSchema),
  customerController.create,
)

customerRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  audit('Customer', 'Update', {
    load: (req) => customerRepository.findById(req.params.id),
    describe: (req, old) => `Customer '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateCustomerSchema),
  customerController.update,
)

customerRoutes.delete(
  '/:id',
  requireRole('ADMIN'),
  audit('Customer', 'Delete', {
    load: (req) => customerRepository.findById(req.params.id),
    describe: (req, old) => `Customer '${old?.name ?? req.params.id}' deleted`,
  }),
  customerController.remove,
)
