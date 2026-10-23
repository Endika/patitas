/** Rising this many dB over the background, a sound counts as a knock, a clap or a call. */
export const ONSET_RISE = 15
/** Quieter than this, in dBFS, nothing counts however quiet the room. */
export const ONSET_FLOOR = -50
/** Seconds after a knock before another can count. */
export const ONSET_GAP = 0.25
/** Knocks within these seconds that make a call. */
export const CALL_KNOCKS = 3,
  CALL_WINDOW = 4

/** Seconds the background takes to follow the room getting quieter or louder between knocks. */
const FLOOR_TAU = 3
/** And while a sound is up: slow, so a knock does not raise it but a television left on does. */
const LOUD_TAU = 20

export interface Ears {
  /** The background level, in dBFS; null until the first sound. */
  floor: number | null
  /** Seconds listened. */
  t: number
  /** When the last knock counted. */
  last: number
  /** Up over the background right now: a knock counts only as it starts. */
  up: boolean
  /** When each knock still within CALL_WINDOW counted. */
  knocks: number[]
}

export const createEars = (): Ears => ({
  floor: null,
  t: 0,
  last: -Infinity,
  up: false,
  knocks: [],
})

/**
 * One level, in dBFS, `dt` seconds after the last: 'noise' as a knock starts over the background,
 * 'call' when it is the CALL_KNOCKS-th within CALL_WINDOW s, null otherwise.
 */
export function hearLevel(ears: Ears, db: number, dt: number): 'noise' | 'call' | null {
  ears.t += dt
  if (ears.floor === null) {
    ears.floor = db
    return null
  }
  const up = db - ears.floor >= ONSET_RISE && db >= ONSET_FLOOR
  ears.floor += (db - ears.floor) * (1 - Math.exp(-dt / (up ? LOUD_TAU : FLOOR_TAU)))
  const starts = up && !ears.up
  ears.up = up
  if (!starts || ears.t - ears.last < ONSET_GAP) return null
  ears.last = ears.t
  ears.knocks = ears.knocks.filter((at) => ears.t - at <= CALL_WINDOW)
  ears.knocks.push(ears.t)
  if (ears.knocks.length < CALL_KNOCKS) return 'noise'
  ears.knocks.length = 0
  return 'call'
}

/** The loudness of `samples`, in dBFS: their root mean square, never below −120. */
export function levelOf(samples: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return Math.max(-120, 20 * Math.log10(rms || 1e-6))
}
