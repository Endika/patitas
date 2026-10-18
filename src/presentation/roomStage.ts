import type { Puppy } from '@/domain/puppy'

export type TrickPose = 'sit' | 'lie' | 'belly'

/** What the room tells the screen: the hint, the happiness bar and the ball button. */
export interface StageStatus {
  hint: string
  /** 0 to 1, of the puppy playing or else the first one. */
  happiness: number
  ball: { inHand: boolean; disabled: boolean }
  /** Shown over the room while it cannot be played: meshing, or no 3D at all. */
  notice: string | null
}

/** The 3D room as the screens see it. */
export interface RoomStage {
  /** Mounts and unmounts puppies to match; only the first two are shown. */
  setPuppies(puppies: Puppy[]): void
  takeBall(): void
  stowBall(): void
  trick(pose: TrickPose): void
  /** Called at once with the current status and again whenever it changes. */
  onChange(listener: (s: StageStatus) => void): () => void
  dispose(): void
}
