import { describe, expect, it } from 'vitest'
import { adoptPuppy } from '../../src/application/adoption'
import { BREEDS } from '../../src/domain/breeds'
import { createCare } from '../../src/domain/care'
import { createMemoryStorage } from '../../src/infrastructure/memoryStorage'

describe('adoptPuppy', () => {
  it('saves every puppy and only fits the first two in the room', async () => {
    const storage = createMemoryStorage()
    let clock = 0
    const deps = { now: () => (clock += 1), random: () => 0.5 }

    const a = await adoptPuppy(storage, { name: 'Luna', breedId: 'dorado' }, deps)
    const b = await adoptPuppy(storage, { name: 'Kira', breedId: 'dorado' }, deps)
    const c = await adoptPuppy(storage, { name: 'Toby', breedId: 'dorado' }, deps)

    expect([a.entered, b.entered, c.entered]).toEqual([true, true, false])
    expect(await storage.listPuppies()).toEqual([a.puppy, b.puppy, c.puppy])
    expect(await storage.loadRoom()).toEqual({ inRoom: [a.puppy.id, b.puppy.id] })
  })

  it('saves the initial care stamped with the adoption time', async () => {
    const storage = createMemoryStorage()
    const { puppy } = await adoptPuppy(
      storage,
      { name: 'Kira', breedId: 'beagle' },
      { now: () => 99, random: () => 0.5 },
    )
    expect(await storage.loadCare(puppy.id)).toEqual(createCare(BREEDS.beagle, 99))
  })
})
