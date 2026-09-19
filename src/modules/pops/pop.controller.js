import { popService } from './pop.service.js'

export const popController = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await popService.listPops(req.user) })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const pop = await popService.createPop(req.body, req.user)
      res.status(201).json({ success: true, data: pop })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      res.json({ success: true, data: await popService.updatePop(req.params.id, req.body, req.user) })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await popService.deletePop(req.params.id, req.user)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async createOlt(req, res, next) {
    try {
      const olt = await popService.createOlt(req.params.id, req.body, req.user)
      res.status(201).json({ success: true, data: olt })
    } catch (err) {
      next(err)
    }
  },

  async updateOlt(req, res, next) {
    try {
      const olt = await popService.updateOlt(req.params.id, req.params.oltId, req.body, req.user)
      res.json({ success: true, data: olt })
    } catch (err) {
      next(err)
    }
  },

  async deleteOlt(req, res, next) {
    try {
      await popService.deleteOlt(req.params.id, req.params.oltId, req.user)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async addDevice(req, res, next) {
    try {
      const device = await popService.addDevice(req.params.id, req.body, req.user)
      res.status(201).json({ success: true, data: device })
    } catch (err) {
      next(err)
    }
  },

  async updateDevice(req, res, next) {
    try {
      const device = await popService.updateDevice(req.params.id, req.params.deviceId, req.body, req.user)
      res.json({ success: true, data: device })
    } catch (err) {
      next(err)
    }
  },

  async deleteDevice(req, res, next) {
    try {
      await popService.removeDevice(req.params.id, req.params.deviceId, req.user)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
