import { useCallback, useEffect, useRef, useState } from 'react'
import { adoptPuppy } from '@/application/adoption'
import type { BreedId } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'
import { enterRoom, leaveRoom, RoomFull, type Room } from '@/domain/room'
import type { GameStorage } from '@/infrastructure/storage'

export interface GameState {
  puppies: Puppy[]
  room: Room
  persistent: boolean
}

export interface Game {
  /** Null until the storage has loaded. */
  state: GameState | null
  /** Throws `InvalidPuppyName`. */
  adopt(input: { name: string; breedId: BreedId }): Promise<Puppy>
  /** False when the room is full. */
  enter(id: string): Promise<boolean>
  leave(id: string): Promise<void>
}

/** The adopted puppies and who is in the room, kept in step with the storage. */
export function useGame(openStorage: () => Promise<GameStorage>): Game {
  const [state, setState] = useState<GameState | null>(null)
  const storage = useRef<GameStorage | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const opened = await openStorage()
      const [puppies, room] = await Promise.all([opened.listPuppies(), opened.loadRoom()])
      if (!live) return
      storage.current = opened
      setState({ puppies, room, persistent: opened.persistent })
    })()
    return () => {
      live = false
    }
  }, [openStorage])

  const adopt = useCallback(async (input: { name: string; breedId: BreedId }) => {
    const s = storage.current!
    const puppy = await adoptPuppy(s, input, { now: Date.now, random: Math.random })
    const [puppies, room] = await Promise.all([s.listPuppies(), s.loadRoom()])
    setState({ puppies, room, persistent: s.persistent })
    return puppy
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

  return { state, adopt, enter, leave }
}
