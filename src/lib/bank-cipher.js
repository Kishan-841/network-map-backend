import { env } from '../config/env.js'
import { createFieldCipher } from './field-cipher.js'

/** The one cipher for partner bank account numbers. */
export const bankCipher = createFieldCipher(env.bankDetailsKey)
