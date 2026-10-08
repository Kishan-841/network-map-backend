import { ApiError } from '../../lib/api-error.js'

/**
 * Society permissions, phase 2 — the approval rules every society change runs
 * through (add, visit update, details edit). Pure: callers apply the result
 * inside their own row-locked write, so "before" is never stale.
 *
 *   status ends ACCEPTED, approval null / REJECTED → SUBMIT (PENDING + SUBMITTED row)
 *   status ends elsewhere, approval PENDING        → WITHDRAW (null + WITHDRAWN row)
 *   approval APPROVED                              → nothing (the status is locked)
 */
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED']

export const SUBMITTED_REMARK = 'Sent for approval'
export const KEEP_STATUS_MESSAGE = 'Approved societies keep their status'

export function approvalTransition({ approval, statusAfter }) {
  if (approval === 'APPROVED') return null
  if (statusAfter === 'ACCEPTED') return approval === 'PENDING' ? null : 'SUBMIT'
  return approval === 'PENDING' ? 'WITHDRAW' : null
}

/**
 * The Building fields a transition writes. A re-submit clears the last
 * decision's who/when (they described the rejection) but keeps its reason
 * until the society is approved — the history carries every one of them.
 */
export function transitionData(transition, now) {
  if (transition === 'SUBMIT') {
    return {
      permissionApproval: 'PENDING',
      approvalSubmittedAt: now,
      approvalDecidedAt: null,
      approvalDecidedById: null,
    }
  }
  if (transition === 'WITHDRAW') return { permissionApproval: null, approvalSubmittedAt: null }
  return {}
}

/**
 * The history row a transition adds. Stamped 1 ms after the row that caused
 * it, so "newest first" always lists the consequence above its cause.
 */
export function transitionVisit(transition, { userId, remark, at }) {
  if (!transition) return null
  return {
    userId,
    kind: transition === 'SUBMIT' ? 'SUBMITTED' : 'WITHDRAWN',
    remark: transition === 'SUBMIT' ? SUBMITTED_REMARK : remark,
    statusBefore: null,
    statusAfter: null,
    changes: [],
    createdAt: new Date(at.getTime() + 1),
  }
}

/**
 * An approved society is locked as Accepted. Its executive may not even send
 * a status (the form hides it); anyone else may send only the same value.
 */
export function assertStatusUnlocked({ approval, current, next, isExecutive }) {
  if (approval !== 'APPROVED' || next === undefined) return
  if (isExecutive || next !== current) throw ApiError.badRequest(KEEP_STATUS_MESSAGE)
}

/** The `approval` object the API hands out — null when the society was never sent. */
export function approvalShape(b) {
  if (!b?.permissionApproval) return null
  return {
    status: b.permissionApproval,
    reason: b.approvalReason ?? null,
    submittedAt: b.approvalSubmittedAt ?? null,
    decidedAt: b.approvalDecidedAt ?? null,
    decidedBy: b.approvalDecidedBy ? { id: b.approvalDecidedBy.id, name: b.approvalDecidedBy.name } : null,
  }
}
