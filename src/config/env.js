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
  r2: {
    // Endpoint: explicit R2_ENDPOINT, or derived from the account id.
    endpoint:
      process.env.R2_ENDPOINT ||
      (process.env.R2_ACCOUNT_ID
        ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined),
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    // Public base URL the files are served from (r2.dev or a custom domain).
    publicUrl: (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, ''),
  },
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

// Fail fast when R2 is selected but not fully configured.
if (env.storageDriver === 'r2') {
  const missing = ['endpoint', 'accessKeyId', 'secretAccessKey', 'bucket', 'publicUrl'].filter(
    (key) => !env.r2[key],
  )
  if (missing.length) {
    throw new Error(
      `STORAGE_DRIVER=r2 requires: ${missing
        .map((key) => `R2_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`)
        .join(', ')}`,
    )
  }
}
