import { fiberService } from './fiber.service.js'

export const fiberController = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await fiberService.listFibers() })
    } catch (err) {
      next(err)
    }
  },

  async get(req, res, next) {
    try {
      res.json({ success: true, data: await fiberService.getFiber(req.params.id) })
    } catch (err) {
      next(err)
    }
  },

  async junctions(req, res, next) {
    try {
      const data = await fiberService.listJunctions({ radiusMeters: req.validatedQuery.radius })
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async mergePoints(req, res, next) {
    try {
      res.status(201).json({ success: true, data: await fiberService.mergePoints(req.body) })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const fiber = await fiberService.createFiber(req.body)
      res.status(201).json({ success: true, data: fiber })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      res.json({ success: true, data: await fiberService.updateFiber(req.params.id, req.body) })
    } catch (err) {
      next(err)
    }
  },

  async setSegmentLaid(req, res, next) {
    try {
      const fiber = await fiberService.setSegmentLaid(req.params.id, req.params.segmentId, req.body)
      res.json({ success: true, data: fiber })
    } catch (err) {
      next(err)
    }
  },

  async cut(req, res, next) {
    try {
      res.json({ success: true, data: await fiberService.cutFiber(req.params.id, req.body) })
    } catch (err) {
      next(err)
    }
  },

  async restore(req, res, next) {
    try {
      res.json({ success: true, data: await fiberService.restoreFiber(req.params.id) })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await fiberService.deleteFiber(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
