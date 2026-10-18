import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPuppy } from '../../src/domain/puppy'
import { openGameStorage } from '../../src/infrastructure/idbStorage'

const realIndexedDb = globalThis.indexedDB

const puppyAt = (name: string, now: number) =>
  createPuppy({ name, breedId: 'dorado', now, random: () => 0.5 })

describe('idbStorage', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })

  afterEach(() => {
    globalThis.indexedDB = realIndexedDb
  })

  it('lists saved puppies ordered by adoption time after reopening', async () => {
    const first = await openGameStorage()
    const late = puppyAt('Luna', 200)
    const early = puppyAt('Kira', 100)
    await first.savePuppy(late)
    await first.savePuppy(early)

    const reopened = await openGameStorage()
    expect(reopened.persistent).toBe(true)
    expect(await reopened.listPuppies()).toEqual([early, late])
  })

  it('removes a puppy', async () => {
    const storage = await openGameStorage()
    const puppy = puppyAt('Luna', 1)
    await storage.savePuppy(puppy)
    await storage.removePuppy(puppy.id)
    expect(await storage.listPuppies()).toEqual([])
  })

  it('defaults to an empty room and keeps the saved room after reopening', async () => {
    const first = await openGameStorage()
    expect(await first.loadRoom()).toEqual({ inRoom: [] })
    await first.saveRoom({ inRoom: ['a', 'b'] })

    const reopened = await openGameStorage()
    expect(await reopened.loadRoom()).toEqual({ inRoom: ['a', 'b'] })
  })

  it('falls back to working in-memory storage when opening fails', async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error('blocked')
      },
    } as unknown as IDBFactory

    const storage = await openGameStorage()
    expect(storage.persistent).toBe(false)
    const puppy = puppyAt('Luna', 1)
    await storage.savePuppy(puppy)
    expect(await storage.listPuppies()).toEqual([puppy])
  })
})
