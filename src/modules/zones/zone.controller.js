import { createZoneService } from './zone.service.js'
import { zoneRepository } from './zone.repository.js'

const zoneService = createZoneService({ zoneRepository })

export const zoneController = {
  async list(req, res, next) {
    try {
      const query = req.validatedQuery ?? {}
      // Dual response: ?page → envelope; without → legacy array (dropdown consumers).
      const data = query.page
        ? await zoneService.listZonesPaged(query, req.user)
        : await zoneService.listZones(req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const zone = await zoneService.createZone(req.body)
      res.status(201).json({ success: true, data: zone })
    } catch (err) {
      next(err)
    }
  },

  async bulk(req, res, next) {
    try {
      const result = await zoneService.bulkCreateZones(req.body.zones)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      const zone = await zoneService.updateZone(req.params.id, req.body)
      res.json({ success: true, data: zone })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await zoneService.deleteZone(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
