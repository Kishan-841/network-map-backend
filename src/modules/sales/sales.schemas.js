import { z } from 'zod'

// Assign / distribute a batch of buildings to one sales user. Ids only — the
// server decides everything else (who may assign, whose pool, history).
export const assignBuildingsSchema = z.object({
  buildingIds: z.array(z.string().min(1)).min(1, 'Select at least one building').max(500),
  assignedToId: z.string().min(1, 'Choose who to assign to'),
})

export const historyQuerySchema = z.object({
  buildingId: z.string().min(1),
})
