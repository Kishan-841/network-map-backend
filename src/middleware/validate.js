export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body)
  if (!result.success) return next(result.error)
  req.body = result.data
  next()
}

// Express 5 exposes req.query via a getter, so validated params land on
// req.validatedQuery instead of being written back.
export const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query)
  if (!result.success) return next(result.error)
  req.validatedQuery = result.data
  next()
}
