import { salesService } from './sales.service.js'

export const salesController = {
  async team(req, res, next) {
    try {
      const data = await salesService.listTeam(req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

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

  async recordVisit(req, res, next) {
    try {
      const data = await salesService.recordVisit(req.body, req.user)
      res.status(201).json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async listVisits(req, res, next) {
    try {
      const data = await salesService.listVisits(req.user, req.query)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async createInquiry(req, res, next) {
    try {
      const data = await salesService.createInquiry(req.body, req.user)
      res.status(201).json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async listInquiries(req, res, next) {
    try {
      const data = await salesService.listInquiries(req.user, req.query)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async dashboard(req, res, next) {
    try {
      const data = await salesService.dashboard(req.user, req.query)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },
}
