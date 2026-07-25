import path from 'node:path'
import { S3Client } from '@aws-sdk/client-s3'
import { env } from '../../config/env.js'
import { createLocalStorageProvider } from './local-storage-provider.js'
import { createR2StorageProvider } from './r2-storage-provider.js'

const providers = {
  local: () =>
    createLocalStorageProvider({
      rootDir: path.resolve(env.uploadsDir),
      baseUrl: `${env.appUrl}/uploads`,
    }),

  r2: () =>
    createR2StorageProvider({
      client: new S3Client({
        region: 'auto',
        endpoint: env.r2.endpoint,
        credentials: {
          accessKeyId: env.r2.accessKeyId,
          secretAccessKey: env.r2.secretAccessKey,
        },
      }),
      bucket: env.r2.bucket,
      publicBaseUrl: env.r2.publicUrl,
    }),
}

export function getStorageProvider() {
  const factory = providers[env.storageDriver]
  if (!factory) throw new Error(`Unknown storage driver: ${env.storageDriver}`)
  return factory()
}
