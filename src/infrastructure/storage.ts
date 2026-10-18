import type { Care } from '../domain/care'
import type { Puppy } from '../domain/puppy'
import type { Room } from '../domain/room'

export interface GameStorage {
  listPuppies(): Promise<Puppy[]>
  savePuppy(puppy: Puppy): Promise<void>
  removePuppy(id: string): Promise<void>
  loadRoom(): Promise<Room>
  saveRoom(room: Room): Promise<void>
  loadCare(id: string): Promise<Care | undefined>
  saveCare(id: string, care: Care): Promise<void>
  readonly persistent: boolean
}
