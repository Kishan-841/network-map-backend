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
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null
  // Read URLs are handed out presigned (?X-Amz-…). If one is ever posted back
  // to us, the key is still the path — strip the query/fragment first.
  const key = url.slice(prefix.length).split('?')[0].split('#')[0]
  if (key.split('/').some((segment) => segment === '..' || segment === '')) return null
  return key
}
