import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appUrl: process.env.APP_URL ?? 'http://localhost:4000',
  uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
  duplicateRadiusMeters: Number(process.env.DUPLICATE_RADIUS_METERS ?? 100),
  // Comma-separated list of allowed browser origins, or '*' (dev default).
  // In production set this to your frontend URL(s).
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
}

// Fail fast in production on an unchanged/weak JWT secret — a shared default
// secret means anyone can forge tokens.
if (env.nodeEnv === 'production') {
  const weak = ['dev-only-change-in-production-8f3k2j', 'changeme', 'secret']
  if (env.jwtSecret.length < 24 || weak.includes(env.jwtSecret.toLowerCase())) {
    throw new Error('JWT_SECRET must be a strong, unique value in production (24+ chars)')
  }
}
