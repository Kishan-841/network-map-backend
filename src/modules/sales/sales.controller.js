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

  async mapBuildings(req, res, next) {
    try {
      const data = await salesService.listMapBuildings(req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async searchBuildings(req, res, next) {
    try {
      const data = await salesService.searchBuildings(req.query.q, req.user)
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

  async openVisit(req, res, next) {
    try {
      const data = await salesService.openVisit(req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async checkIn(req, res, next) {
    try {
      const data = await salesService.checkIn(req.body, req.user)
      res.status(201).json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async addActivity(req, res, next) {
    try {
      const data = await salesService.addActivity(req.params.id, req.body, req.user)
      res.status(201).json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async removeActivity(req, res, next) {
    try {
      const data = await salesService.removeActivity(req.params.id, req.params.type, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async checkOut(req, res, next) {
    try {
      const data = await salesService.checkOut(req.params.id, req.body, req.user)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async getVisit(req, res, next) {
    try {
      const data = await salesService.getVisit(req.params.id, req.user)
      res.json({ success: true, data })
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
