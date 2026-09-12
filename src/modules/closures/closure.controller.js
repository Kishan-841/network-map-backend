import { ApiError } from '../../lib/api-error.js'
import { closureService } from './closure.service.js'

function parsePortNo(req) {
  const portNo = Number.parseInt(req.params.portNo, 10)
  if (Number.isNaN(portNo)) throw ApiError.badRequest('portNo must be a number')
  return portNo
}

export const closureController = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await closureService.listClosures() })
    } catch (err) {
      next(err)
    }
  },

  async get(req, res, next) {
    try {
      res.json({ success: true, data: await closureService.getClosure(req.params.id) })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const closure = await closureService.createClosure(req.body)
      res.status(201).json({ success: true, data: closure })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      res.json({ success: true, data: await closureService.updateClosure(req.params.id, req.body) })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await closureService.deleteClosure(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async addSplitter(req, res, next) {
    try {
      const splitter = await closureService.addSplitter(req.params.id, req.body)
      res.status(201).json({ success: true, data: splitter })
    } catch (err) {
      next(err)
    }
  },
}

export const splitterController = {
  async update(req, res, next) {
    try {
      res.json({ success: true, data: await closureService.updateSplitter(req.params.id, req.body) })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await closureService.deleteSplitter(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async setOutput(req, res, next) {
    try {
      const portNo = parsePortNo(req)
      const output = await closureService.setOutput(req.params.id, portNo, req.body)
      res.json({ success: true, data: output })
    } catch (err) {
      next(err)
    }
  },
}
