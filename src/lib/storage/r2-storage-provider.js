import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { buildObjectKey, keyFromPublicUrl, keyFromSignedUrl } from './object-key.js'

const READ_URL_TTL_SECONDS = 15 * 60

/**
 * Cloudflare R2 (S3-compatible) storage provider. Same contract as the local
 * provider — save/delete/keyFromUrl — so the app never knows which is active.
 *
 * `publicBaseUrl` is the canonical URL form we STORE in the database — it is
 * the stable identity of an object, not necessarily a readable link. Reads go
 * out presigned via `readUrl()`, so photos stay private once public access is
 * turned off on the bucket. `client` is an S3Client (injected for tests).
 */
export function createR2StorageProvider({ client, bucket, publicBaseUrl }) {
  // Either form of our own URL resolves to the same object: the canonical
  // public one we store, or the presigned S3-host one `readUrl()` hands out.
  const keyOf = (url) => keyFromPublicUrl(url, publicBaseUrl) ?? keyFromSignedUrl(url, bucket)

  return {
    async save({ buffer, extension, contentType }) {
      const key = buildObjectKey(extension)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      )
      return { key, url: `${publicBaseUrl}/${key}` }
    },

    async delete({ key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },

    keyFromUrl(url) {
      return keyOf(url)
    },

    // The stable form we store. Read URLs handed to browsers are signed and
    // expire; if one is posted back to us on an edit, this turns it back into
    // the object's identity so we never persist a link that dies.
    canonicalUrl(url) {
      const key = keyOf(url)
      return key ? `${publicBaseUrl}/${key}` : url
    },

    /**
     * A short-lived signed link for ONE object. Handed out at response time and
     * never stored — the row keeps the canonical URL. The TTL is long enough to
     * open a building and read its photos, short enough that a leaked link (a
     * shared screenshot, a browser history entry) stops working quickly.
     */
    async readUrl(url, { expiresIn = READ_URL_TTL_SECONDS } = {}) {
      const key = keyOf(url)
      if (!key) return url
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn,
      })
    },

    /**
     * A short-lived link the browser PUTs one file to, straight into the
     * bucket (the 100 MB APK never passes through our server). The signature
     * pins the key and content type: the upload must send that exact type.
     */
    async uploadUrl({ key, contentType, expiresIn = 15 * 60 }) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn,
        // Sign content-type so the upload must send exactly this type.
        signableHeaders: new Set(['content-type']),
      })
    },

    /** A short-lived download link for a key we hold (never stored). */
    async downloadUrl({ key, expiresIn = 60 * 60, filename }) {
      if (filename && /["\r\n]/.test(filename)) throw new Error('Invalid download filename')
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
        }),
        { expiresIn },
      )
    },

    async exists({ key }) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return true
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false
        throw err
      }
    },
  }
}
