import type { Puppy } from '../domain/puppy'
import type { Room } from '../domain/room'
import type { GameStorage } from './storage'

export function createMemoryStorage(): GameStorage {
  const puppies = new Map<string, Puppy>()
  let room: Room = { inRoom: [] }
  return {
    persistent: false,
    listPuppies: async () => [...puppies.values()].sort((a, b) => a.adoptedAt - b.adoptedAt),
    savePuppy: async (puppy) => {
      puppies.set(puppy.id, puppy)
    },
    removePuppy: async (id) => {
      puppies.delete(id)
    },
    loadRoom: async () => ({ inRoom: [...room.inRoom] }),
    saveRoom: async (next) => {
      room = { inRoom: [...next.inRoom] }
    },
  }
}
