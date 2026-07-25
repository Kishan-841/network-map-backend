import { randomUUID } from 'node:crypto'

/** Storage key shared by every provider: "YYYY/MM/<uuid>.<ext>". */
export function buildObjectKey(extension) {
  const now = new Date()
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  return `${dir}/${randomUUID()}.${extension}`
}

/** Map a public URL back to its storage key, rejecting foreign/traversal URLs. */
export function keyFromPublicUrl(url, baseUrl) {
  const prefix = `${baseUrl}/`
  if (!url.startsWith(prefix)) return null
  const key = url.slice(prefix.length)
  if (key.split('/').some((segment) => segment === '..' || segment === '')) return null
  return key
}
