import type { Puppy } from '@/domain/puppy'

/** Shown instead of a stage when the browser has no WebGL. */
export const NO_3D = 'Este navegador no puede mostrar gráficos 3D.'

export type TrickPose = 'sit' | 'lie' | 'belly'

/** One puppy's care as the room keeps it, rounded to hundredths, and how full its bowl is. */
export interface PuppyNeeds {
  name: string
  hunger: number
  energy: number
  cleanliness: number
  happiness: number
  weightKg: number
  bowl: number
}

/** What the room tells the screen: the hint, the happiness bar and the ball button. */
export interface StageStatus {
  hint: string
  /** 0 to 1, of the puppy playing or else the first one. */
  happiness: number
  ball: { inHand: boolean; disabled: boolean }
  /** Shown over the room while it cannot be played: meshing, or no 3D at all. */
  notice: string | null
  /** Each puppy in the room, in its order. */
  needs: PuppyNeeds[]
}

/** The 3D room as the screens see it. */
export interface RoomStage {
  /** Mounts and unmounts puppies to match; only the first two are shown. */
  setPuppies(puppies: Puppy[]): void
  takeBall(): void
  stowBall(): void
  trick(pose: TrickPose): void
  /** Fills the bowl of every puppy in the room. */
  feed(): void
  /** Called at once with the current status and again whenever it changes. */
  onChange(listener: (s: StageStatus) => void): () => void
  dispose(): void
}
