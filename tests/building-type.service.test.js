import { describe, it, expect, vi } from 'vitest'
import { createBuildingTypeService } from '../src/modules/building-types/building-type.service.js'

function fakeRepo(types = []) {
  const store = [...types]
  return {
    store,
    findById: vi.fn(async (id) => store.find((t) => t.id === id) ?? null),
    findByName: vi.fn(async (name) => store.find((t) => t.name === name) ?? null),
    create: vi.fn(async (data) => {
      const type = { id: `t-${store.length + 1}`, ...data }
      store.push(type)
      return type
    }),
    update: vi.fn(async (id, data) => {
      const type = store.find((t) => t.id === id)
      Object.assign(type, data)
      return type
    }),
    delete: vi.fn(async () => {}),
  }
}

describe('building type service', () => {
  it('creates a type', async () => {
    const service = createBuildingTypeService({ buildingTypeRepository: fakeRepo() })
    const type = await service.createType({ name: 'Row House' })
    expect(type.name).toBe('Row House')
  })

  it('409s on duplicate name', async () => {
    const service = createBuildingTypeService({
      buildingTypeRepository: fakeRepo([{ id: 't1', name: 'Residential' }]),
    })
    await expect(service.createType({ name: 'Residential' })).rejects.toMatchObject({ status: 409 })
  })

  it('renames a type', async () => {
    const service = createBuildingTypeService({
      buildingTypeRepository: fakeRepo([{ id: 't1', name: 'Residential' }]),
    })
    const type = await service.renameType('t1', { name: 'Residential Tower' })
    expect(type.name).toBe('Residential Tower')
  })

  it('404s renaming or deleting a missing type', async () => {
    const service = createBuildingTypeService({ buildingTypeRepository: fakeRepo() })
    await expect(service.renameType('nope', { name: 'X' })).rejects.toMatchObject({ status: 404 })
    await expect(service.deleteType('nope')).rejects.toMatchObject({ status: 404 })
  })

  it('deletes an existing type', async () => {
    const repo = fakeRepo([{ id: 't1', name: 'Industrial' }])
    const service = createBuildingTypeService({ buildingTypeRepository: repo })
    await service.deleteType('t1')
    expect(repo.delete).toHaveBeenCalledWith('t1')
  })
})
