import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { ApiError } from '../lib/api-error.js'

export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    const error = { code: err.code, message: err.message }
    if (err.details !== undefined) error.details = err.details
    return res.status(err.status).json({ success: false, error })
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.flatten().fieldErrors,
      },
    })
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'A record with this value already exists',
        details: { fields: err.meta?.target },
      },
    })
  }

  console.error(err)
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  })
}
