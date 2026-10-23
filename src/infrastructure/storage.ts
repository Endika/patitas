import type { Care } from '../domain/care'
import type { Puppy } from '../domain/puppy'
import type { Room } from '../domain/room'
import type { Wallet } from '../domain/wallet'

export interface GameStorage {
  listPuppies(): Promise<Puppy[]>
  savePuppy(puppy: Puppy): Promise<void>
  removePuppy(id: string): Promise<void>
  loadRoom(): Promise<Room>
  saveRoom(room: Room): Promise<void>
  loadCare(id: string): Promise<Care | undefined>
  saveCare(id: string, care: Care): Promise<void>
  /** The house's coins, if it has ever had any. */
  loadWallet(): Promise<Wallet | undefined>
  saveWallet(wallet: Wallet): Promise<void>
  readonly persistent: boolean
}
