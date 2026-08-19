import { fiberRouteService } from './fiber-route.service.js'

export const fiberRouteController = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await fiberRouteService.listFiberRoutes() })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const route = await fiberRouteService.createFiberRoute(req.body)
      res.status(201).json({ success: true, data: route })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      res.json({
        success: true,
        data: await fiberRouteService.updateFiberRoute(req.params.id, req.body),
      })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await fiberRouteService.deleteFiberRoute(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
