import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createLocalStorageProvider({ rootDir, baseUrl }) {
  return {
    async save({ buffer, extension }) {
      const now = new Date()
      const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
      const key = `${dir}/${randomUUID()}.${extension}`

      await mkdir(path.join(rootDir, dir), { recursive: true })
      await writeFile(path.join(rootDir, key), buffer)
      return { key, url: `${baseUrl}/${key}` }
    },

    async delete({ key }) {
      // Containment check: never touch anything outside rootDir (path traversal).
      const root = path.resolve(rootDir)
      const target = path.resolve(root, key)
      if (!target.startsWith(root + path.sep)) return
      await rm(target, { force: true })
    },

    keyFromUrl(url) {
      const prefix = `${baseUrl}/`
      if (!url.startsWith(prefix)) return null
      const key = url.slice(prefix.length)
      // Reject traversal or empty segments — keys are always "yyyy/mm/uuid.ext".
      if (key.split('/').some((segment) => segment === '..' || segment === '')) return null
      return key
    },
  }
}
