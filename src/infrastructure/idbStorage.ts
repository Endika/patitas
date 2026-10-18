import { openDB, type DBSchema } from 'idb'
import { withCareDefaults, type Care } from '../domain/care'
import type { Puppy } from '../domain/puppy'
import type { Room } from '../domain/room'
import { createMemoryStorage } from './memoryStorage'
import type { GameStorage } from './storage'

interface PatitasDb extends DBSchema {
  puppies: { key: string; value: Puppy }
  meta: { key: string; value: Room }
  care: { key: string; value: Care }
}

const ROOM_KEY = 'room'

export async function openGameStorage(): Promise<GameStorage> {
  try {
    const db = await openDB<PatitasDb>('patitas', 2, {
      upgrade(upgrading, oldVersion) {
        if (oldVersion < 1) {
          upgrading.createObjectStore('puppies', { keyPath: 'id' })
          upgrading.createObjectStore('meta')
        }
        if (oldVersion < 2) upgrading.createObjectStore('care')
      },
    })
    return {
      persistent: true,
      listPuppies: async () =>
        (await db.getAll('puppies')).sort((a, b) => a.adoptedAt - b.adoptedAt),
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
      loadRoom: async () => (await db.get('meta', ROOM_KEY)) ?? { inRoom: [] },
      saveRoom: async (room) => {
        await db.put('meta', room, ROOM_KEY)
      },
    }
  } catch {
    return createMemoryStorage()
  }
}
