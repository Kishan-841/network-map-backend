import { ApiError } from '../../lib/api-error.js'
import { getStorageProvider } from '../../lib/storage/index.js'

export const ALLOWED_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/**
 * Answers with two links: `url`, the permanent one a form saves, and
 * `previewUrl`, a short-lived signed one for showing the file right away.
 * Never save `previewUrl` — it expires. (With a private bucket the permanent
 * link does not open on its own, so a page must preview with `previewUrl`.)
 */
export function createUploadController({ storage }) {
  return {
    async upload(req, res, next) {
      try {
        if (!req.file) throw ApiError.badRequest('No file provided (field name: file)')
        const extension = ALLOWED_MIME_TYPES[req.file.mimetype]
        const { url } = await storage.save({
          buffer: req.file.buffer,
          extension,
          contentType: req.file.mimetype, // R2 stores it so images render inline
        })
        const previewUrl = storage.readUrl ? await storage.readUrl(url) : url
        res.status(201).json({ success: true, data: { url, previewUrl } })
      } catch (err) {
        next(err)
      }
    },
  }
}

export const uploadController = createUploadController({ storage: getStorageProvider() })
