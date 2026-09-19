/**
 * Service unit tests check business rules — port clashes, splitter feeds —
 * not who may see a row. Those services now take the actor as their LAST
 * argument and fail closed without one, so this wraps a service to append an
 * ADMIN (who may touch anything) at the position each method declares.
 * Ownership itself is covered end to end in network-ownership.route.test.js.
 */
export const ADMIN = { id: 'u-admin', role: 'ADMIN' }

export function asAdmin(service) {
  return new Proxy(service, {
    get(target, key) {
      const fn = target[key]
      if (typeof fn !== 'function') return fn
      return (...args) => {
        const padded = [...args]
        while (padded.length < fn.length - 1) padded.push(undefined)
        return fn(...padded, ADMIN)
      }
    },
  })
}
