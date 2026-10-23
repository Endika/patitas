import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { BREEDS } from '../../src/domain/breeds'
import { addMess, cleanMess, createCare } from '../../src/domain/care'
import { createPuppy } from '../../src/domain/puppy'
import { openGameStorage } from '../../src/infrastructure/idbStorage'
import { createWallet } from '../../src/domain/wallet'

const realIndexedDb = globalThis.indexedDB
const pee = { kind: 'pee', x: -0.4, z: 0.3, createdAt: 10 } as const
const poop = { kind: 'poop', x: 0.5, z: 1.1, createdAt: 20 } as const

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

  it('gives a puppy saved before it had them a liking for the bath and for company, and keeps it', async () => {
    const { bath: _bath, social: _social, ...persona } = puppyAt('Luna', 1).persona
    const older = { ...puppyAt('Luna', 1), persona }
    const db = await openDB('patitas', 2, {
      upgrade(upgrading) {
        upgrading.createObjectStore('puppies', { keyPath: 'id' })
        upgrading.createObjectStore('meta')
        upgrading.createObjectStore('care')
      },
    })
    await db.put('puppies', older)
    db.close()

    const [loaded] = await (await openGameStorage()).listPuppies()
    // Near the dorado's own: fond of the bath and of company
    expect(Math.abs(loaded!.persona.bath - 0.8)).toBeLessThanOrEqual(0.15)
    expect(Math.abs(loaded!.persona.social - 0.9)).toBeLessThanOrEqual(0.15)
    const raw = await openDB('patitas', 2)
    expect((await raw.get('puppies', older.id)).persona).toEqual(loaded!.persona)
    raw.close()
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

  it('has no wallet until one is saved, then keeps it across reopening, apart from the room', async () => {
    const first = await openGameStorage()
    expect(await first.loadWallet()).toBeUndefined()
    const wallet = { ...createWallet(10), coins: 73 }
    await first.saveWallet(wallet)
    await first.saveRoom({ inRoom: ['a'] })

    const reopened = await openGameStorage()
    expect(await reopened.loadWallet()).toEqual(wallet)
    expect(await reopened.loadRoom()).toEqual({ inRoom: ['a'] })
  })

  it('has no settings until saved, then keeps them across reopening', async () => {
    const first = await openGameStorage()
    expect(await first.loadSettings()).toBeUndefined()
    await first.saveSettings({ listen: true, explained: true })
    expect(await (await openGameStorage()).loadSettings()).toEqual({
      listen: true,
      explained: true,
    })
  })

  it('keeps care across reopening', async () => {
    const first = await openGameStorage()
    expect(await first.loadCare('x')).toBeUndefined()
    const care = createCare(BREEDS.dorado, 7)
    await first.saveCare('x', care)
    expect(await (await openGameStorage()).loadCare('x')).toEqual(care)
  })

  it('keeps the messes on the floor until one is cleaned up', async () => {
    const first = await openGameStorage()
    const messy = addMess(addMess(createCare(BREEDS.dorado, 7), pee), poop)
    await first.saveCare('x', messy)
    const loaded = (await (await openGameStorage()).loadCare('x'))!
    expect(loaded.messes).toEqual([pee, poop])
    await first.saveCare('x', cleanMess(loaded, loaded.messes[0]!))
    expect((await (await openGameStorage()).loadCare('x'))!.messes).toEqual([poop])
  })

  it('reads care saved before messes as having none', async () => {
    const storage = await openGameStorage()
    const { bladder: _b, messes: _m, gloom: _g, ...old } = createCare(BREEDS.dorado, 7)
    const raw = await openDB('patitas', 2)
    await raw.put('care', old, 'x')
    raw.close()
    expect(await storage.loadCare('x')).toEqual(createCare(BREEDS.dorado, 7))
  })

  it('upgrades a v1 database keeping puppies and room', async () => {
    const v1 = await openDB('patitas', 1, {
      upgrade(db) {
        db.createObjectStore('puppies', { keyPath: 'id' })
        db.createObjectStore('meta')
      },
    })
    const puppy = puppyAt('Luna', 5)
    await v1.put('puppies', puppy)
    await v1.put('meta', { inRoom: [puppy.id] }, 'room')
    v1.close()

    const storage = await openGameStorage()
    expect(storage.persistent).toBe(true)
    expect(await storage.listPuppies()).toEqual([puppy])
    expect(await storage.loadRoom()).toEqual({ inRoom: [puppy.id] })
    expect(await storage.loadCare(puppy.id)).toBeUndefined()
  })
  it('says so when another tab keeps the old version open, and goes on once it closes', async () => {
    const old = await openDB('patitas', 1, {
      upgrade(db) {
        db.createObjectStore('puppies', { keyPath: 'id' })
        db.createObjectStore('meta')
      },
    })
    let blocked = 0
    const opening = openGameStorage({ blocked: () => void blocked++, reload: () => {} })
    await vi.waitFor(() => expect(blocked).toBe(1))
    old.close()
    expect((await opening).persistent).toBe(true)
  })

  it('lets go and reloads when another tab wants to upgrade', async () => {
    let reloads = 0
    const storage = await openGameStorage({ blocked: () => {}, reload: () => void reloads++ })
    const next = await openDB('patitas', 3, { upgrade() {} })
    expect(reloads).toBe(1)
    next.close()
    await expect(storage.listPuppies()).rejects.toThrow()
  })
})
