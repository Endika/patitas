import type { Puppy } from '@/domain/puppy'
import type { RoomStage, StageStatus } from '@/presentation/roomStage'
import { createMemoryStorage } from '@/infrastructure/memoryStorage'
import type { GameStorage } from '@/infrastructure/storage'

/** A room with no 3D: it records what the screen asks of it and lets a test push status. */
export function createFakeStage() {
  const calls: string[] = []
  const shown: Puppy[][] = []
  const listeners = new Set<(s: StageStatus) => void>()
  let status: StageStatus = {
    hint: 'Toca el suelo y irá hacia allí.',
    happiness: 0.3,
    ball: { inHand: false, disabled: false },
    notice: null,
  }
  const stage: RoomStage = {
    setPuppies(puppies) {
      shown.push(puppies)
    },
    takeBall: () => void calls.push('takeBall'),
    stowBall: () => void calls.push('stowBall'),
    trick: (pose) => void calls.push(`trick:${pose}`),
    onChange(listener) {
      listeners.add(listener)
      listener(status)
      return () => listeners.delete(listener)
    },
    dispose: () => void calls.push('dispose'),
  }
  return {
    calls,
    /** Names of the puppies the room shows now. */
    names: () => (shown.at(-1) ?? []).map((p) => p.name),
    emit(next: Partial<StageStatus>) {
      status = { ...status, ...next }
      for (const l of listeners) l(status)
    },
    create: (_canvas: HTMLCanvasElement) => stage,
  }
}

/** The in-memory storage, as if the browser could keep it. */
export const savingStorage = (): GameStorage => ({ ...createMemoryStorage(), persistent: true })
