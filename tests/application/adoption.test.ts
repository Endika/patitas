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

    expect(await storage.listPuppies()).toEqual([a, b, c])
    expect(await storage.loadRoom()).toEqual({ inRoom: [a.id, b.id] })
  })
})
