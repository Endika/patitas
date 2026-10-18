import type { BreedId } from '../domain/breeds'
import { BREEDS } from '../domain/breeds'
import { createCare } from '../domain/care'
import { createPuppy, type Puppy } from '../domain/puppy'
import { enterRoom, RoomFull } from '../domain/room'
import type { GameStorage } from '../infrastructure/storage'

export interface Adoption {
  puppy: Puppy
  /** False when the room was full and the puppy waits outside. */
  entered: boolean
}

export async function adoptPuppy(
  storage: GameStorage,
  input: { name: string; breedId: BreedId },
  deps: { now: () => number; random: () => number },
): Promise<Adoption> {
  const now = deps.now()
  const puppy = createPuppy({ ...input, now, random: deps.random })
  await storage.savePuppy(puppy)
  await storage.saveCare(puppy.id, createCare(BREEDS[input.breedId], now))
  try {
    await storage.saveRoom(enterRoom(await storage.loadRoom(), puppy.id))
  } catch (error) {
    if (!(error instanceof RoomFull)) throw error
    return { puppy, entered: false }
  }
  return { puppy, entered: true }
}
