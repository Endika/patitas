import type { MessKind, WeightStatus } from '@/domain/care'
import type { Puppy } from '@/domain/puppy'

/** Shown instead of a stage when the browser has no WebGL. */
export const NO_3D = 'Este navegador no puede mostrar gráficos 3D.'

export type TrickPose = 'sit' | 'lie' | 'belly'

/** What the player is doing for a puppy's care: bathing it, brushing it or weighing it. */
export type CareMode = 'bath' | 'brush' | 'weigh'

/** One puppy's care as the room keeps it, rounded to hundredths, and how full its bowl is. */
export interface PuppyNeeds {
  name: string
  hunger: number
  energy: number
  cleanliness: number
  happiness: number
  weightKg: number
  bowl: number
  wet: number
  /** How glossy brushing has left its coat. */
  shine: number
  mode: CareMode | null
  /** The scale's reading the last time it was weighed, as «4,3 kg», and how that is for its breed. */
  reading: string | null
  weightStatus: WeightStatus | null
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
  /**
   * Starts the bath of the puppy at `index` where it stands: rubbing it lathers and scrubs it.
   * One bath at a time, and not while it plays ball.
   */
  bath(index: number): void
  /** «Aclarar»: washes the foam off and soaks it; it shakes itself and is ready for the dryer. */
  rinse(): void
  /** «Secador»: from the rinse on, the finger dries the fur it passes over. */
  dryer(): void
  /** «Terminar»: the bath is over and it dries by itself whatever is left. */
  finishBath(): void
  /**
   * «Cepillo» on the puppy at `index`: it stands still where it is and strokes with the grain make
   * it shine. One puppy at a time, not in its bath, and not while it plays ball.
   */
  brush(index: number): void
  /** The brush is put away. */
  endBrush(): void
  /**
   * «Pesar» on the puppy at `index`: it walks to the scale and stands on it while the scale reads
   * its weight. One at a time; a call, a trick or the ball calls it off.
   */
  weigh(index: number): void
  /** Debug page only: sends the first puppy into the puddle, if it is awake and doing nothing else. */
  toMud?(): void
  /** Debug page only: the first puppy squats where it stands, if it is awake and doing nothing else. */
  relieve?(kind: MessKind): void
  /** Called at once with the current status and again whenever it changes. */
  onChange(listener: (s: StageStatus) => void): () => void
  dispose(): void
}
