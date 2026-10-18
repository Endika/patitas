export type GaitId = 'walk' | 'trot' | 'hop'

export interface Gait {
  speed: number
  freq: number
  duty: number
  lift: number
  /** Phase of each leg within the cycle, in the order [LF, RF, LH, RH]. */
  off: [number, number, number, number]
}

export const GAITS: Record<GaitId, Gait> = {
  walk: { speed: 0.3, freq: 1.7, duty: 0.62, lift: 0.035, off: [0.25, 0.75, 0, 0.5] },
  trot: { speed: 0.75, freq: 2.8, duty: 0.5, lift: 0.05, off: [0, 0.5, 0.5, 0] },
  hop: { speed: 1.05, freq: 3, duty: 0.38, lift: 0.07, off: [0, 0.06, 0.5, 0.56] },
}
