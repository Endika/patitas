import type { Puppy } from '@/domain/puppy'
import type { RoomStage, StageStatus } from '@/presentation/roomStage'
import type { PreviewStage, PreviewStatus } from '@/presentation/previewStage'
import { createMemoryStorage } from '@/infrastructure/memoryStorage'
import type { GameStorage } from '@/infrastructure/storage'

/** A room with no 3D: it records what the screen asks of it and lets a test push status. */
export function createFakeStage() {
  const calls: string[] = []
  const canvases: HTMLCanvasElement[] = []
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
    /** Every canvas a stage was created on, in order. */
    canvases,
    /** Names of the puppies the room shows now. */
    names: () => (shown.at(-1) ?? []).map((p) => p.name),
    emit(next: Partial<StageStatus>) {
      status = { ...status, ...next }
      for (const l of listeners) l(status)
    },
    create: (canvas: HTMLCanvasElement) => {
      canvases.push(canvas)
      return stage
    },
  }
}

/** The in-memory storage, as if the browser could keep it. */
export const savingStorage = (): GameStorage => ({ ...createMemoryStorage(), persistent: true })

/** An adoption preview with no 3D: it records what it is asked and lets a test push status. */
export function createFakePreview() {
  const calls: string[] = []
  const canvases: HTMLCanvasElement[] = []
  const listeners = new Set<(s: PreviewStatus) => void>()
  let status: PreviewStatus = { loading: true, notice: null }
  return {
    calls,
    canvases,
    emit(next: Partial<PreviewStatus>) {
      status = { ...status, ...next }
      for (const l of listeners) l(status)
    },
    create: (canvas: HTMLCanvasElement): PreviewStage => {
      canvases.push(canvas)
      return {
        show: (id) => void calls.push(`show:${id}`),
        onStatus(listener) {
          listeners.add(listener)
          listener(status)
          return () => void listeners.delete(listener)
        },
        dispose: () => void calls.push('dispose'),
      }
    },
  }
}
