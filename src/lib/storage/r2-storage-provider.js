import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { buildObjectKey, keyFromPublicUrl } from './object-key.js'

/**
 * Cloudflare R2 (S3-compatible) storage provider. Same contract as the local
 * provider — save/delete/keyFromUrl — so the app never knows which is active.
 *
 * `publicBaseUrl` is the bucket's public URL (r2.dev or a custom domain);
 * stored file URLs are served straight from there. `client` is an S3Client
 * (injected so it can be faked in tests).
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
  }
}
