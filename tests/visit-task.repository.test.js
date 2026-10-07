import { describe, it, expect } from 'vitest'
import { visitTaskRepository as repo } from '../src/modules/visit-tasks/visit-task.repository.js'

describe('visitTaskRepository', () => {
  it('has every method the service uses', () => {
    for (const m of [
      'listUsersForPlanning', 'zoneIdsFor', 'listBuildingsLite', 'searchBuildings', 'tasksInRange',
      'visitsInRange', 'findTask', 'createTask', 'updateTask', 'deleteTask', 'importPlan', 'listUploads',
      'assignBuilding',
    ]) expect(typeof repo[m]).toBe('function')
  })
})
