import { openDB, type DBSchema } from 'idb'
import { withCareDefaults, type Care } from '../domain/care'
import { withPersonaDefaults, type Puppy } from '../domain/puppy'
import type { Room } from '../domain/room'
import type { Wallet } from '../domain/wallet'
import { createMemoryStorage } from './memoryStorage'
import type { GameStorage } from './storage'

interface PatitasDb extends DBSchema {
  puppies: { key: string; value: Puppy }
  meta: { key: string; value: Room | Wallet }
  care: { key: string; value: Care }
}

const ROOM_KEY = 'room',
  WALLET_KEY = 'wallet'

/** What the storage needs from the page when another tab holds a different version open. */
export interface StorageHooks {
  /** Another tab keeps the old version open, so this one cannot upgrade until it closes. */
  blocked(): void
  /** Another tab wants to upgrade: this connection is already closed, so the page must reload. */
  reload(): void
}

const NO_HOOKS: StorageHooks = { blocked() {}, reload: () => globalThis.location?.reload() }

export async function openGameStorage(hooks: StorageHooks = NO_HOOKS): Promise<GameStorage> {
  try {
    const db = await openDB<PatitasDb>('patitas', 2, {
      upgrade(upgrading, oldVersion) {
        if (oldVersion < 1) {
          upgrading.createObjectStore('puppies', { keyPath: 'id' })
          upgrading.createObjectStore('meta')
        }
        if (oldVersion < 2) upgrading.createObjectStore('care')
      },
      blocked: () => hooks.blocked(),
      blocking() {
        db.close()
        hooks.reload()
      },
    })
    return {
      persistent: true,
      listPuppies: async () => {
        const byAdoption = (puppies: Puppy[]) => puppies.sort((a, b) => a.adoptedAt - b.adoptedAt)
        // Saved as completed in the read's own transaction, so a puppy removed meanwhile stays
        // gone; should saving fail, the same traits come out of its id next time
        try {
          const tx = db.transaction('puppies', 'readwrite')
          const stored = await tx.store.getAll()
          const puppies = stored.map(withPersonaDefaults)
          await Promise.all([
            ...puppies.filter((p, i) => p !== stored[i]).map((p) => tx.store.put(p)),
            tx.done,
          ])
          return byAdoption(puppies)
        } catch {
          return byAdoption((await db.getAll('puppies')).map(withPersonaDefaults))
        }
      },
      savePuppy: async (puppy) => {
        await db.put('puppies', puppy)
      },
      removePuppy: async (id) => {
        await db.delete('puppies', id)
        await db.delete('care', id)
      },
      loadCare: async (id) => {
        const care = await db.get('care', id)
        return care && withCareDefaults(care)
      },
      saveCare: async (id, care) => {
        await db.put('care', care, id)
      },
      loadRoom: async () =>
        ((await db.get('meta', ROOM_KEY)) as Room | undefined) ?? { inRoom: [] },
      saveRoom: async (room) => {
        await db.put('meta', room, ROOM_KEY)
      },
      loadWallet: async () => (await db.get('meta', WALLET_KEY)) as Wallet | undefined,
      saveWallet: async (wallet) => {
        await db.put('meta', wallet, WALLET_KEY)
      },
    }
  } catch {
    return createMemoryStorage()
  }
}
