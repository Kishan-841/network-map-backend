import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildObjectKey, keyFromPublicUrl } from './object-key.js'

export function createLocalStorageProvider({ rootDir, baseUrl }) {
  return {
    async save({ buffer, extension }) {
      const key = buildObjectKey(extension)
      await mkdir(path.join(rootDir, path.dirname(key)), { recursive: true })
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
      return keyFromPublicUrl(url, baseUrl)
    },

    // The stable form we store. Read URLs handed to browsers are signed and
    // expire; if one is posted back to us on an edit, this turns it back into
    // the object's identity so we never persist a link that dies.
    canonicalUrl(url) {
      const key = keyFromPublicUrl(url, baseUrl)
      return key ? `${baseUrl}/${key}` : url
    },

    // Dev serves uploads off the local disk behind the app itself — there is
    // nothing to sign, so the canonical URL is already the read URL.
    async readUrl(url) {
      return url
    },
  }
}
