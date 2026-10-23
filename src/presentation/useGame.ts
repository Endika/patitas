import { useCallback, useEffect, useRef, useState } from 'react'
import { adoptPuppy, type Adoption } from '@/application/adoption'
import type { BreedId } from '@/domain/breeds'
import type { Care } from '@/domain/care'
import type { Puppy } from '@/domain/puppy'
import { createWallet, earn, type Deed, type Wallet } from '@/domain/wallet'
import { enterRoom, leaveRoom, RoomFull, type Room } from '@/domain/room'
import type { GameStorage } from '@/infrastructure/storage'

export interface GameState {
  puppies: Puppy[]
  room: Room
  persistent: boolean
  wallet: Wallet
}

export interface Game {
  /** Null until the storage has loaded. */
  state: GameState | null
  /** Throws `InvalidPuppyName`. */
  adopt(input: { name: string; breedId: BreedId }): Promise<Adoption>
  /** False when the room is full. */
  enter(id: string): Promise<boolean>
  leave(id: string): Promise<void>
  /** The care saved for a puppy, as it was when last seen. */
  loadCare(id: string): Promise<Care | undefined>
  saveCare(id: string, care: Care): Promise<void>
  /** Pays for a deed, within the day's limits: the coins gained, 0 when none. */
  earn(deed: Deed): number
}

/** The adopted puppies and who is in the room, kept in step with the storage. */
export function useGame(
  openStorage: () => Promise<GameStorage>,
  now: () => number = Date.now,
): Game {
  const [state, setState] = useState<GameState | null>(null)
  const storage = useRef<GameStorage | null>(null)
  /** The wallet as last changed, ahead of the render that shows it. */
  const wallet = useRef<Wallet | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const opened = await openStorage()
      const [puppies, room, saved] = await Promise.all([
        opened.listPuppies(),
        opened.loadRoom(),
        opened.loadWallet(),
      ])
      if (!live) return
      storage.current = opened
      wallet.current = saved ?? createWallet(now())
      setState({ puppies, room, persistent: opened.persistent, wallet: wallet.current })
    })()
    return () => {
      live = false
    }
  }, [openStorage, now])

  const adopt = useCallback(async (input: { name: string; breedId: BreedId }) => {
    const s = storage.current!
    const adoption = await adoptPuppy(s, input, { now: Date.now, random: Math.random })
    const [puppies, room] = await Promise.all([s.listPuppies(), s.loadRoom()])
    setState((prev) => prev && { ...prev, puppies, room })
    return adoption
  }, [])

  const saveRoom = useCallback(async (change: (room: Room) => Room) => {
    const s = storage.current!
    const room = change(await s.loadRoom())
    await s.saveRoom(room)
    setState((prev) => prev && { ...prev, room })
  }, [])

  const enter = useCallback(
    async (id: string) => {
      try {
        await saveRoom((room) => enterRoom(room, id))
        return true
      } catch (error) {
        if (error instanceof RoomFull) return false
        throw error
      }
    },
    [saveRoom],
  )

  const leave = useCallback((id: string) => saveRoom((room) => leaveRoom(room, id)), [saveRoom])

  const loadCare = useCallback((id: string) => storage.current!.loadCare(id), [])
  const saveCare = useCallback((id: string, care: Care) => storage.current!.saveCare(id, care), [])

  const earnFor = useCallback(
    (deed: Deed) => {
      const s = storage.current
      if (!s || !wallet.current) return 0
      const paid = earn(wallet.current, deed, now())
      wallet.current = paid.wallet
      if (paid.gained) {
        setState((prev) => prev && { ...prev, wallet: paid.wallet })
        s.saveWallet(paid.wallet).catch(() => {})
      }
      return paid.gained
    },
    [now],
  )

  return { state, adopt, enter, leave, loadCare, saveCare, earn: earnFor }
}
