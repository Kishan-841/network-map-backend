import { salesService } from './sales.service.js'

export const salesController = {
  async myBuildings(req, res, next) {
    try {
      const data = await salesService.listMyBuildings(req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async history(req, res, next) {
    try {
      const data = await salesService.assignmentHistory(req.query.buildingId, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async assign(req, res, next) {
    try {
      const data = await salesService.assignBuildings(req.body, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },
}
