import { env } from '../../config/env.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { createBuildingService } from './building.service.js'
import { buildingRepository } from './building.repository.js'
import { userRepository } from '../users/user.repository.js'
import { zoneRepository } from '../zones/zone.repository.js'
import { operatorRepository } from '../operators/operator.repository.js'
import { buildingsWorkbook, workbookFilename } from './building-workbook.js'

const buildingService = createBuildingService({
  buildingRepository,
  storage: getStorageProvider(),
  userRepository,
  zoneRepository,
  operatorRepository,
})

export const buildingController = {
  async create(req, res, next) {
    try {
      const building = await buildingService.createBuilding(req.body, req.user.id, req.user)
      res.status(201).json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },

  async bulk(req, res, next) {
    try {
      const result = await buildingService.bulkCreateBuildings(req.body.rows, req.user.id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  /**
   * The filtered list as an .xlsx download.
   *
   * Streams a buffer rather than JSON, so the browser saves a file instead of
   * the page having to build one. The filters arrive exactly as the list takes
   * them, so "export" always means "export what I am looking at".
   */
  async exportXlsx(req, res, next) {
    try {
      const data = await buildingService.exportBuildings(req.validatedQuery ?? {}, req.user)
      const buffer = await buildingsWorkbook(data)
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      res.setHeader('Content-Disposition', `attachment; filename="${workbookFilename()}"`)
      // The browser reads this to warn when a huge registry was cut short.
      res.setHeader('X-Export-Truncated', String(data.truncated))
      res.setHeader('X-Export-Rows', String(data.rows.length))
      res.send(Buffer.from(buffer))
    } catch (err) {
      next(err)
    }
  },

  async list(req, res, next) {
    try {
      const buildings = await buildingService.listBuildings(req.validatedQuery ?? {}, req.user)
      res.json({ success: true, data: buildings })
    } catch (err) {
      next(err)
    }
  },

  async markers(req, res, next) {
    try {
      const markers = await buildingService.listMarkers(req.validatedQuery ?? {}, req.user)
      res.json({ success: true, data: markers })
    } catch (err) {
      next(err)
    }
  },

  async bulkDelete(req, res, next) {
    try {
      const result = await buildingService.bulkDeleteBuildings(req.body, req.user)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  async bulkAssignOlt(req, res, next) {
    try {
      const result = await buildingService.bulkAssignOlt(req.body, req.user)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  async bulkStatus(req, res, next) {
    try {
      const result = await buildingService.bulkSetLive(req.body, req.user)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  async nearby(req, res, next) {
    try {
      const { latitude, longitude, radius, name, placeId } = req.validatedQuery
      const buildings = await buildingService.findNearby({
        latitude,
        longitude,
        radiusMeters: radius ?? env.duplicateRadiusMeters,
        name,
        placeId,
      }, req.user)
      res.json({ success: true, data: buildings })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      const building = await buildingService.updateBuilding(req.params.id, req.body, req.user)
      res.json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },

  async updateStatus(req, res, next) {
    try {
      const building = await buildingService.updateStatus(req.params.id, req.body)
      res.json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },

  async addPhoto(req, res, next) {
    try {
      const photo = await buildingService.addPhoto(req.params.id, req.body, req.user)
      res.status(201).json({ success: true, data: photo })
    } catch (err) {
      next(err)
    }
  },

  async removePhoto(req, res, next) {
    try {
      await buildingService.removePhoto(req.params.id, req.params.photoId, req.user)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await buildingService.deleteBuilding(req.params.id)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },

  async get(req, res, next) {
    try {
      const building = await buildingService.getBuilding(req.params.id, req.user)
      res.json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },
}
