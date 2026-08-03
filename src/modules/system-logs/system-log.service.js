import { sanitizeValue } from './sanitize.js'
import { systemLogRepository as defaultSystemLogRepository } from './system-log.repository.js'
import { userRepository as defaultUserRepository } from '../users/user.repository.js'

const SEARCH_FIELDS = ['userName', 'userEmail', 'description', 'recordId', 'ipAddress']

export function createSystemLogService({ systemLogRepository, userRepository }) {
  return {
    // Fire-and-forget: audit logging must never break or slow the real request.
    async recordLog(entry) {
      try {
        let { userName = null, userEmail = null, userRole = null } = entry
        if (entry.userId && !userName) {
          const user = await userRepository.findById(entry.userId).catch(() => null)
          if (user) ({ name: userName, email: userEmail, role: userRole } = user)
        }
        await systemLogRepository.create({
          userId: entry.userId ?? null,
          userName,
          userEmail,
          userRole,
          module: entry.module,
          action: entry.action,
          description: entry.description,
          // Prisma Json? fields must be omitted (undefined), never JS null.
          oldValue: sanitizeValue(entry.oldValue) ?? undefined,
          newValue: sanitizeValue(entry.newValue) ?? undefined,
          recordId: entry.recordId ?? null,
          buildingId: entry.buildingId ?? null,
          ipAddress: entry.ipAddress ?? null,
          device: entry.device ?? null,
          browser: entry.browser ?? null,
          os: entry.os ?? null,
          requestUrl: entry.requestUrl,
          httpMethod: entry.httpMethod,
          status: entry.status,
          statusCode: entry.statusCode ?? null,
          errorMessage: entry.errorMessage ?? null,
        })
      } catch (err) {
        console.error('system-log write failed:', err)
      }
    },

    async listLogs(query) {
      const { page, pageSize, dateFrom, dateTo, userId, role, module, action, status, ipAddress, search } =
        query
      const and = []
      if (dateFrom) and.push({ createdAt: { gte: dateFrom } })
      if (dateTo) and.push({ createdAt: { lte: dateTo } })
      if (userId) and.push({ userId })
      if (role) and.push({ userRole: role })
      if (module) and.push({ module })
      if (action) and.push({ action })
      if (status) and.push({ status })
      if (ipAddress) and.push({ ipAddress })
      if (search) {
        and.push({
          OR: SEARCH_FIELDS.map((field) => ({
            [field]: { contains: search, mode: 'insensitive' },
          })),
        })
      }
      const where = and.length ? { AND: and } : {}
      const [items, total] = await Promise.all([
        systemLogRepository.findMany({ where, skip: (page - 1) * pageSize, take: pageSize }),
        systemLogRepository.count(where),
      ])
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    },
  }
}

export const systemLogService = createSystemLogService({
  systemLogRepository: defaultSystemLogRepository,
  userRepository: defaultUserRepository,
})
