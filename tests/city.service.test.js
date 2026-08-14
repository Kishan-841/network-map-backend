import { describe, it, expect, vi } from 'vitest'
import { createCityService } from '../src/modules/cities/city.service.js'

function fakeRepo({ existing = null, city = { id: 'c1', name: 'Pune' } } = {}) {
  return {
    list: vi.fn(async () => [{ ...city, operatorCount: 2 }]),
    findById: vi.fn(async (id) => (id === city.id ? city : null)),
    findByName: vi.fn(async () => existing),
    create: vi.fn(async (data) => ({ id: 'new', ...data })),
    update: vi.fn(async (id, data) => ({ ...city, ...data })),
    delete: vi.fn(async () => {}),
  }
}

describe('city service', () => {
  it('creates a city', async () => {
    const repo = fakeRepo()
    const service = createCityService({ cityRepository: repo })
    const created = await service.createCity({ name: 'Mumbai' })
    expect(repo.create).toHaveBeenCalledWith({ name: 'Mumbai' })
    expect(created.id).toBe('new')
  })

  it('409s a duplicate name (case-insensitive match in repo)', async () => {
    const repo = fakeRepo({ existing: { id: 'c1', name: 'pune' } })
    const service = createCityService({ cityRepository: repo })
    await expect(service.createCity({ name: 'Pune' })).rejects.toMatchObject({ status: 409 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it("renames a city, rejecting a rename onto another city's name", async () => {
    const repo = fakeRepo()
    const service = createCityService({ cityRepository: repo })
    await expect(service.updateCity('c1', { name: 'Pune City' })).resolves.toMatchObject({
      name: 'Pune City',
    })
    const clash = fakeRepo({ existing: { id: 'OTHER', name: 'mumbai' } })
    await expect(
      createCityService({ cityRepository: clash }).updateCity('c1', { name: 'Mumbai' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('404s update/delete of an unknown city', async () => {
    const service = createCityService({ cityRepository: fakeRepo() })
    await expect(service.updateCity('nope', { name: 'X' })).rejects.toMatchObject({ status: 404 })
    await expect(service.deleteCity('nope')).rejects.toMatchObject({ status: 404 })
  })

  it("deletes an existing city (operators are SetNull'd by the FK)", async () => {
    const repo = fakeRepo()
    const service = createCityService({ cityRepository: repo })
    await service.deleteCity('c1')
    expect(repo.delete).toHaveBeenCalledWith('c1')
  })
})
