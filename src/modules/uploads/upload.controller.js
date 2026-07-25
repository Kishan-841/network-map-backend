import { ApiError } from '../../lib/api-error.js'
import { getStorageProvider } from '../../lib/storage/index.js'

export const ALLOWED_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

const storage = getStorageProvider()

export const uploadController = {
  async upload(req, res, next) {
    try {
      if (!req.file) throw ApiError.badRequest('No file provided (field name: file)')
      const extension = ALLOWED_MIME_TYPES[req.file.mimetype]
      const { url } = await storage.save({ buffer: req.file.buffer, extension })
      res.status(201).json({ success: true, data: { url } })
    } catch (err) {
      next(err)
    }
  },
}
