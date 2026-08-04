import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import multer from 'multer'
import { ApiError } from '../lib/api-error.js'

const send = (res, status, code, message, details) =>
  res.status(status).json({ success: false, error: { code, message, ...(details && { details }) } })

export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    const error = { code: err.code, message: err.message }
    if (err.details !== undefined) error.details = err.details
    return res.status(err.status).json({ success: false, error })
  }

  if (err instanceof ZodError) {
    return send(res, 400, 'VALIDATION_ERROR', 'Invalid request data', err.flatten().fieldErrors)
  }

  // Multer surfaces upload problems (oversized/too many files) as MulterError.
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(res, 413, 'FILE_TOO_LARGE', 'File is too large')
    return send(res, 400, 'BAD_REQUEST', 'File upload rejected')
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return send(res, 409, 'CONFLICT', 'A record with this value already exists', {
          fields: err.meta?.target,
        })
      case 'P2025':
        return send(res, 404, 'NOT_FOUND', 'Resource not found')
      case 'P2003':
        return send(res, 400, 'BAD_REQUEST', 'Referenced record does not exist')
      default:
        break
    }
  }

  // Malformed query args (e.g. a raw null for a Json? field) — a bad request,
  // not a server fault.
  if (err instanceof Prisma.PrismaClientValidationError) {
    return send(res, 400, 'BAD_REQUEST', 'Invalid request data')
  }

  console.error(err)
  return send(res, 500, 'INTERNAL_ERROR', 'Something went wrong')
}
