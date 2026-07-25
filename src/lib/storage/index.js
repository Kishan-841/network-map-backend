import path from 'node:path'
import { env } from '../../config/env.js'
import { createLocalStorageProvider } from './local-storage-provider.js'

const providers = {
  local: () =>
    createLocalStorageProvider({
      rootDir: path.resolve(env.uploadsDir),
      baseUrl: `${env.appUrl}/uploads`,
    }),
}

export function getStorageProvider() {
  const factory = providers[env.storageDriver]
  if (!factory) throw new Error(`Unknown storage driver: ${env.storageDriver}`)
  return factory()
}
