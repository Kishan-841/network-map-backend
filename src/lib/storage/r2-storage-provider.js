import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { buildObjectKey, keyFromPublicUrl } from './object-key.js'

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
      return keyFromPublicUrl(url, publicBaseUrl)
    },

    // The stable form we store. Read URLs handed to browsers are signed and
    // expire; if one is posted back to us on an edit, this turns it back into
    // the object's identity so we never persist a link that dies.
    canonicalUrl(url) {
      const key = keyFromPublicUrl(url, publicBaseUrl)
      return key ? `${publicBaseUrl}/${key}` : url
    },

    /**
     * A short-lived signed link for ONE object. Handed out at response time and
     * never stored — the row keeps the canonical URL. The TTL is long enough to
     * open a building and read its photos, short enough that a leaked link (a
     * shared screenshot, a browser history entry) stops working quickly.
     */
    async readUrl(url, { expiresIn = READ_URL_TTL_SECONDS } = {}) {
      const key = keyFromPublicUrl(url, publicBaseUrl)
      if (!key) return url
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn,
      })
    },
  }
}
