import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../../middleware/auth.js'
import { ApiError } from '../../lib/api-error.js'
import { uploadController, ALLOWED_MIME_TYPES } from './upload.controller.js'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES[file.mimetype]) return cb(null, true)
    cb(ApiError.badRequest('Only JPEG, PNG, WebP images or PDF files are allowed'))
  },
})

export const uploadRoutes = Router()

uploadRoutes.post('/', requireAuth, upload.single('file'), uploadController.upload)
