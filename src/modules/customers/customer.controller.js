import { getStorageProvider } from '../../lib/storage/index.js'
import { buildingRepository } from '../buildings/building.repository.js'
import { createBuildingService } from '../buildings/building.service.js'
import { operatorRepository } from '../operators/operator.repository.js'
import { userRepository } from '../users/user.repository.js'
import { zoneRepository } from '../zones/zone.repository.js'
import { getOpticalLookup } from './optical-lookup.js'
import { customerRepository } from './customer.repository.js'
import { createCustomerService } from './customer.service.js'
import { csvFilename } from '../../lib/customer-list.js'

// The list read rides the buildings read rule, so the buildings service is
// assembled here exactly as building.controller.js does — same repositories,
// same storage provider (only the signed photo URLs need it).
const buildingService = createBuildingService({
  buildingRepository,
  storage: getStorageProvider(),
  userRepository,
  zoneRepository,
  operatorRepository,
})

const customerService = createCustomerService({
  customerRepository,
  buildingService,
  getOpticalLookup,
})

export { setOpticalLookupForTests } from './optical-lookup.js'

export const customerController = {
  async list(req, res, next) {
    try {
      const data = await customerService.listCustomers(req.validatedQuery, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async listAll(req, res, next) {
    try {
      const data = await customerService.listAllCustomers(req.validatedQuery, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  /** The current filter as a CSV file (cap 5 000; X-Truncated when cut short). */
  async exportCsv(req, res, next) {
    try {
      const { csv, truncated } = await customerService.exportCustomersCsv(req.validatedQuery, req.user)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${csvFilename()}"`)
      if (truncated) res.setHeader('X-Truncated', 'true')
      res.send(csv)
    } catch (err) {
      next(err)
    }
  },

  async connections(req, res, next) {
    try {
      const data = await customerService.getBuildingConnections(req.validatedQuery, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async connection(req, res, next) {
    try {
      const data = await customerService.getCustomerConnection(req.params.id, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async get(req, res, next) {
    try {
      const customer = await customerService.getCustomer(req.params.id, req.user)
      res.json({ success: true, data: customer })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const customer = await customerService.createCustomer(req.body, req.user)
      res.status(201).json({ success: true, data: customer })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      const customer = await customerService.updateCustomer(req.params.id, req.body)
      res.json({ success: true, data: customer })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await customerService.deleteCustomer(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  /** The import preview resolves every distinct building name in the sheet. */
  async lookup(req, res, next) {
    try {
      const matches = await customerService.lookupBuildings(req.body.names)
      res.json({ success: true, data: matches })
    } catch (err) {
      next(err)
    }
  },

  async importRows(req, res, next) {
    try {
      const result = await customerService.importCustomers(req.body.rows, req.user, {
        dryRun: req.body.dryRun === true,
      })
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
}
