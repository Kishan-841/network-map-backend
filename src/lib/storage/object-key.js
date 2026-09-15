import { randomUUID } from 'node:crypto'

/** Storage key shared by every provider: "YYYY/MM/<uuid>.<ext>". */
export function buildObjectKey(extension) {
  const now = new Date()
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
  return `${dir}/${randomUUID()}.${extension}`
}

const safeKey = (key) =>
  key && !key.split('/').some((segment) => segment === '..' || segment === '') ? key : null

/** Map a public URL back to its storage key, rejecting foreign/traversal URLs. */
export function keyFromPublicUrl(url, baseUrl) {
  const prefix = `${baseUrl}/`
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null
  // Read URLs are handed out presigned (?X-Amz-…). If one is ever posted back
  // to us, the key is still the path — strip the query/fragment first.
  const key = url.slice(prefix.length).split('?')[0].split('#')[0]
  return safeKey(key)
}

const S3_HOST_SUFFIX = '.r2.cloudflarestorage.com'

/**
 * Map one of OUR OWN presigned read URLs back to its storage key.
 *
 * `readUrl()` signs against the S3 API host
 * (`<bucket>.<account>.r2.cloudflarestorage.com`), which is NOT the public base
 * URL a stored URL uses. A client editing a record echoes back exactly what we
 * served it, so without this the round trip reads as a foreign URL and the
 * write is refused (400 "…must come from the uploads API").
 */
export function keyFromSignedUrl(url, bucket) {
  if (typeof url !== 'string' || !bucket) return null
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (!parsed.hostname.endsWith(S3_HOST_SUFFIX)) return null

  let path
  if (parsed.hostname.startsWith(`${bucket}.`)) {
    path = parsed.pathname // virtual-hosted style
  } else if (parsed.pathname.startsWith(`/${bucket}/`)) {
    path = parsed.pathname.slice(bucket.length + 1) // path style
  } else {
    return null
  }

  let decoded
  try {
    decoded = decodeURIComponent(path.replace(/^\/+/, ''))
  } catch {
    return null
  }
  return safeKey(decoded)
}
