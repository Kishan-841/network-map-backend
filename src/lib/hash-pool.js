import { Worker } from 'node:worker_threads'
import os from 'node:os'

const WORKER_URL = new URL('./hash-worker.js', import.meta.url)

/**
 * Hash many passwords with bcrypt on worker threads, so the API keeps
 * answering everyone else meanwhile. bcryptjs is pure JavaScript: 500 hashes
 * on the main thread froze the whole server for ~32 s (13 Oct measurement).
 *
 * Workers are started for this call and stopped after it — bulk imports are
 * rare, so a long-lived pool would only hold memory. Same bcrypt format as
 * `bcrypt.hash`, so logins verify these like any other hash.
 */
export async function hashPasswords(passwords, rounds) {
  if (passwords.length === 0) return []
  const cpus = os.availableParallelism?.() ?? os.cpus().length
  // Leave one core for the API itself.
  const size = Math.max(1, Math.min(4, cpus - 1, passwords.length))
  const workers = Array.from({ length: size }, () => new Worker(WORKER_URL))
  try {
    const hashes = new Array(passwords.length)
    let next = 0
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            const send = () => {
              if (next >= passwords.length) return resolve()
              const index = next++
              worker.postMessage({ index, password: passwords[index], rounds })
            }
            worker.on('message', ({ index, hash }) => {
              hashes[index] = hash
              send()
            })
            worker.on('error', reject)
            send()
          }),
      ),
    )
    return hashes
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()))
  }
}
