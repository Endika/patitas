import type { Care } from '../domain/care'
import type { Puppy } from '../domain/puppy'
import type { Room } from '../domain/room'
import type { Settings } from '../domain/settings'
import type { Wallet } from '../domain/wallet'
import type { GameStorage } from './storage'

export function createMemoryStorage(): GameStorage {
  const puppies = new Map<string, Puppy>()
  const cares = new Map<string, Care>()
  let room: Room = { inRoom: [] }
  let wallet: Wallet | undefined
  let settings: Settings | undefined
  return {
    persistent: false,
    listPuppies: async () => [...puppies.values()].sort((a, b) => a.adoptedAt - b.adoptedAt),
    savePuppy: async (puppy) => {
      puppies.set(puppy.id, puppy)
    },
    removePuppy: async (id) => {
      puppies.delete(id)
      cares.delete(id)
    },
    loadCare: async (id) => {
      const care = cares.get(id)
      return care && { ...care, messes: [...care.messes] }
    },
    saveCare: async (id, care) => {
      cares.set(id, { ...care })
    },
    loadRoom: async () => ({ inRoom: [...room.inRoom] }),
    saveRoom: async (next) => {
      room = { inRoom: [...next.inRoom] }
    },
    loadWallet: async () => wallet && structuredClone(wallet),
    saveWallet: async (next) => {
      wallet = structuredClone(next)
    },
    loadSettings: async () => settings && { ...settings },
    saveSettings: async (next) => {
      settings = { ...next }
    },
  }
}
