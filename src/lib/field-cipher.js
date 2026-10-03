import crypto from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * Encrypts one database field (a partner's bank account number) with
 * AES-256-GCM. GCM also authenticates: a value altered in the database, or
 * read with the wrong key, throws instead of decrypting to rubbish.
 *
 * Stored as "v1:<iv>:<tag>:<ciphertext>" (base64 parts). The version prefix is
 * what a future key rotation would switch on.
 */
export function createFieldCipher(keyBase64) {
  const key = Buffer.from(keyBase64 ?? '', 'base64')
  if (key.length !== 32) throw new Error('BANK_DETAILS_KEY must be 32 bytes, base64-encoded')

  return {
    encrypt(plain) {
      const iv = crypto.randomBytes(IV_BYTES)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
      return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
    },
    decrypt(stored) {
      const [version, iv, tag, data] = String(stored ?? '').split(':')
      if (version !== VERSION || !iv || !tag || !data) throw new Error('Unreadable encrypted value')
      const ivBuf = Buffer.from(iv, 'base64')
      const tagBuf = Buffer.from(tag, 'base64')
      // A short tag would let GCM authenticate with fewer bits (Node accepts
      // 4-byte tags unless told otherwise) — refuse anything but the full 16.
      if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) throw new Error('Unreadable encrypted value')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf, { authTagLength: TAG_BYTES })
      decipher.setAuthTag(tagBuf)
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
    },
  }
}
