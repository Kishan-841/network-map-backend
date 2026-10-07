import { z } from 'zod'
import { parseSheetDate } from '../../lib/visit-plan.js'

const weekdays = z.array(z.boolean()).length(7)

export const previewSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int(),
    // A planner's pick from the candidates — still resolved only within their scope.
    assigneeId: z.string().min(1).max(100).optional(),
    buildingId: z.string().min(1).max(100).optional(),
    employee: z.string().max(200).default(''),
    building: z.string().max(300).default(''),
    date: z.string().max(40).default(''),
    startTime: z.string().max(20).default(''),
    endTime: z.string().max(20).default(''),
    until: z.string().max(40).default(''),
    weekdays,
  })).min(1).max(3000),
}).strict()

export const importSchema = z.object({
  fileName: z.string().max(200).optional(),
  rows: z.array(z.object({
    rowNumber: z.number().int(),
    assigneeId: z.string().min(1),
    buildingId: z.string().min(1),
    date: z.string().max(40),
    startTime: z.string().max(20).nullable(),
    endTime: z.string().max(20).nullable(),
    until: z.string().max(40).nullable(),
    weekdays,
  })).min(1).max(3000),
}).strict()
// A real calendar day: '2026-02-30' must be refused here, not by Prisma later.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => parseSheetDate(d) === d, 'Not a real date')

export const rangeQuerySchema = z.object({
  userId: z.string().min(1).max(100).optional(),
  from: day.optional(),
  to: day.optional(),
})

// One task added or edited by hand. A window is both times or neither (checked in the service).
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm').nullable()
const taskFields = {
  assigneeId: z.string().min(1).max(100),
  buildingId: z.string().min(1).max(100),
  taskDate: day,
  startTime: hhmm,
  endTime: hhmm,
}
export const taskSchema = z.object(taskFields).strict()
export const taskPatchSchema = z.object(taskFields).partial().strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
