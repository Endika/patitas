import { describe, expect, it } from 'vitest'
import { adoptPuppy } from '../../src/application/adoption'
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
})
