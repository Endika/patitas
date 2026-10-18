import type { Puppy } from '../domain/puppy'
import type { Room } from '../domain/room'

export interface GameStorage {
  listPuppies(): Promise<Puppy[]>
  savePuppy(puppy: Puppy): Promise<void>
  removePuppy(id: string): Promise<void>
  loadRoom(): Promise<Room>
  saveRoom(room: Room): Promise<void>
  readonly persistent: boolean
}
