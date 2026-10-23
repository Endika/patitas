import { useCallback, useEffect, useRef, useState } from 'react'
import { adoptPuppy, type Adoption } from '@/application/adoption'
import type { BreedId } from '@/domain/breeds'
import type { Care } from '@/domain/care'
import { teach, wear, type Puppy, type Trick } from '@/domain/puppy'
import {
  buy,
  choose,
  spendOne,
  type CollarLook,
  type Consumable,
  type ItemId,
  type Keepsake,
} from '@/domain/shop'
import { createWallet, earn, withWalletDefaults, type Deed, type Wallet } from '@/domain/wallet'
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
  /** False when the coins do not reach. */
  buy(id: ItemId): boolean
  /** Uses one up; false when there is none left. */
  spend(id: Consumable): boolean
  /** Puts a keepsake the house has to use: the toy to throw, or a colour for the room. */
  use(id: Keepsake): void
  /** A treat taught the puppy a little more of `trick`. */
  teach(id: string, trick: Trick): Promise<void>
  /** Puts a collar on the puppy, or takes its collar off. */
  wear(id: string, collar: CollarLook | null): Promise<void>
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
      wallet.current = saved ? withWalletDefaults(saved) : createWallet(now())
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

  /** Changes the wallet as `change` says, unless it says no; saved in the background. */
  const change = useCallback((next: (w: Wallet) => Wallet | null) => {
    const s = storage.current
    const changed = s && wallet.current && next(wallet.current)
    if (!changed) return false
    wallet.current = changed
    setState((prev) => prev && { ...prev, wallet: changed })
    s.saveWallet(changed).catch(() => {})
    return true
  }, [])
  const buyItem = useCallback((id: ItemId) => change((w) => buy(w, id)), [change])
  const spend = useCallback((id: Consumable) => change((w) => spendOne(w, id)), [change])
  const putToUse = useCallback((id: Keepsake) => void change((w) => choose(w, id)), [change])

  const earnFor = useCallback(
    (deed: Deed) => {
      let gained = 0
      change((w) => {
        const paid = earn(w, deed, now())
        gained = paid.gained
        return gained ? paid.wallet : null
      })
      return gained
    },
    [change, now],
  )

  /** Saves the puppy `id` as `change` leaves it. */
  const changePuppy = useCallback(async (id: string, change: (p: Puppy) => Puppy) => {
    const s = storage.current!
    const puppy = (await s.listPuppies()).find((p) => p.id === id)
    if (!puppy) return
    const changed = change(puppy)
    await s.savePuppy(changed)
    setState(
      (prev) => prev && { ...prev, puppies: prev.puppies.map((p) => (p.id === id ? changed : p)) },
    )
  }, [])
  const teachTrick = useCallback(
    (id: string, trick: Trick) => changePuppy(id, (p) => teach(p, trick)),
    [changePuppy],
  )
  const wearCollar = useCallback(
    (id: string, collar: CollarLook | null) => changePuppy(id, (p) => wear(p, collar)),
    [changePuppy],
  )

  return {
    state,
    adopt,
    enter,
    leave,
    loadCare,
    saveCare,
    earn: earnFor,
    buy: buyItem,
    spend,
    use: putToUse,
    teach: teachTrick,
    wear: wearCollar,
  }
}
