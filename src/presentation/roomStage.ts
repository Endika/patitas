import type { Care, Health, MessKind, PlaceAccident, WeightStatus } from '@/domain/care'
import type { CollarLook, Decor, FoodId, ToyId } from '@/domain/shop'
import type { Puppy, Trick } from '@/domain/puppy'
import type { Deed } from '@/domain/wallet'

/** Shown instead of a stage when the browser has no WebGL. */
export const NO_3D = 'Este navegador no puede mostrar gráficos 3D.'

export type TrickPose = Trick

/** What the player is doing for a puppy's care: bathing it, brushing it or weighing it. */
export type CareMode = 'bath' | 'brush' | 'weigh'

/** Where a bath stands: lathering, then rinsed (the rinse, the shake and drying). */
export type BathStep = 'scrub' | 'rinsed'

/** One puppy's care as the room keeps it, rounded to hundredths, and how full its bowl is. */
export interface PuppyNeeds {
  id: string
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
  /** In its bath, how far it has got, and whether the dryer is in hand. */
  bath: BathStep | null
  dryer: boolean
  health: Health
  asleep: boolean
  /** The scale's reading the last time it was weighed, as «5,24 kg», and how that is for its breed. */
  reading: string | null
  weightStatus: WeightStatus | null
}

/** What the room tells the screen: the hint, the ball button and each puppy's needs. */
export interface StageStatus {
  hint: string
  ball: { inHand: boolean; disabled: boolean }
  /** Shown over the room while it cannot be played: meshing, or no 3D at all. */
  notice: string | null
  /** Each puppy in the room, in its order. */
  needs: PuppyNeeds[]
  /** The puppy last touched in the room, and how many touches there have been. */
  touched: { id: string; count: number } | null
  /** A mess was just cleaned up: true for a moment. */
  cleaned: boolean
}

/** The 3D room as the screens see it. */
export interface RoomStage {
  /**
   * Mounts and unmounts puppies to match; only the first two are shown. A puppy coming in starts
   * from its care in `cares`, or else a new one.
   */
  setPuppies(puppies: Puppy[], cares?: ReadonlyMap<string, Care>): void
  /** The care of each puppy in the room as it is now, by id, those still loading included. */
  cares(): Map<string, Care>
  /**
   * One placer for the accidents of `count` puppies caught up together: kept apart from each
   * other and from every mess already on the floor.
   */
  placeAccidents(count: number): PlaceAccident | undefined
  /**
   * Back after `away` milliseconds with the app hidden: each puppy in `cares` takes its caught-up
   * care and its coat shows it; at night, after a while away, they are found asleep in their beds.
   */
  resume(cares: ReadonlyMap<string, Care>, away: number): void
  takeBall(): void
  /** What the ball button throws from now on; one in the air or in a mouth is swapped once back. */
  setToy(toy: ToyId): void
  /** The colours of the beds, the bowls and the rug. */
  setDecor(decor: Decor): void
  /** The collar the puppy `id` wears, or none; one still loading puts it on once it comes in. */
  setCollar(id: string, collar: CollarLook | null): void
  stowBall(): void
  /**
   * The puppy at `index` does the trick, if it is free to: at once if it knows it well, else
   * after a puzzled look.
   */
  trick(index: number, pose: TrickPose): void
  /**
   * A treat for the puppy at `index`, if it is awake to take it: null when not, else the trick
   * it learnt a little more of, given just after doing it.
   */
  treat(index: number): { taught: TrickPose | null } | null
  /**
   * Rings the puppy at `index` on the floor as the one the buttons are for, or nobody: only while
   * two are in the room and neither is in its bath or being brushed.
   */
  select(index: number | null): void
  /**
   * Fills the bowl of the puppy at `index`, or every bowl in the room, with plain food or with
   * `food`. Says whether there was a bowl to fill.
   */
  feed(index?: number, food?: FoodId): boolean
  /**
   * Starts the bath of the puppy at `index` where it stands: rubbing it lathers and scrubs it.
   * One bath at a time, and not while it plays ball. A ball in hand is put away.
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
  /** Called whenever the player does something for a puppy that earns coins. */
  onDeed(listener: (deed: Deed) => void): () => void
  dispose(): void
}
