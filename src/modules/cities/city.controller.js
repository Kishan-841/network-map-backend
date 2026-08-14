import { cityService } from './city.service.js'

export const cityController = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await cityService.listCities() })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const city = await cityService.createCity(req.body)
      res.status(201).json({ success: true, data: city })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      res.json({ success: true, data: await cityService.updateCity(req.params.id, req.body) })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await cityService.deleteCity(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
