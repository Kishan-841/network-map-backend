// Worker thread for lib/hash-pool.js: hashes one password per message.
import { parentPort } from 'node:worker_threads'
import bcrypt from 'bcryptjs'

parentPort.on('message', ({ index, password, rounds }) => {
  parentPort.postMessage({ index, hash: bcrypt.hashSync(password, rounds) })
})
