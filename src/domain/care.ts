import type { Breed } from './breeds'

export type MessKind = 'pee' | 'poop'

/**
 * A pee or a poop waiting on the floor. `z` is its depth in the play area and `x` its place across
 * it as a share of the half width there (−1 to 1), so it stays in frame on any screen.
 */
export interface Mess {
  kind: MessKind
  x: number
  z: number
  createdAt: number
}

export interface Care {
  hunger: number
  cleanliness: number
  energy: number
  happiness: number
  weightKg: number
  wet: number
  lastSeen: number
  /** 0 to 1: at 1 it has to go. */
  bladder: number
  /** What it left on the floor and nobody has cleaned up yet, at most MESS_CAP. */
  messes: Mess[]
  /** Happiness the waiting messes have taken so far, up to MESS_GLOOM_MAX. */
  gloom: number
  /** 0 to 1: how glossy and fluffy brushing has left the coat. */
  shine: number
}

export type Health = 'Muy bien' | 'Bien' | 'Necesita cuidados'
export type WeightStatus = 'Un poco flaco' | 'En su peso' | 'Un poco gordito'

export const HUNGER_PER_HOUR = 0.12
export const CLEANLINESS_LOSS_PER_HOUR = 0.02
export const ENERGY_REST_PER_HOUR = 0.25
export const ENERGY_MOVE_LOSS_PER_HOUR = 0.3
export const HAPPINESS_DRIFT_PER_HOUR = 0.05
/** Left alone, a soaked coat dries in about 10 min. */
export const WET_LOSS_PER_SECOND = 1 / 600
/** A brushed coat loses its shine in about a day. */
export const SHINE_LOSS_PER_HOUR = 1 / 24
export const MEAL_WEIGHT_KG = 0.02
export const PLAY_WEIGHT_KG_PER_MINUTE = 0.004
export const MEAL_HUNGER = 0.7

export const BLADDER_PER_HOUR = 0.35
export const BLADDER_PER_MEAL = 0.3
export const MESS_CAP = 2
export const MESS_CLEANLINESS = 0.03
export const MESS_GLOOM_MAX = 0.1
export const MESS_GLOOM_PER_HOUR = 0.6
const POOP_CHANCE = 0.35,
  POOP_CHANCE_FED = 0.6

export const CATCH_UP_MAX_HUNGER = 0.85
export const CATCH_UP_MIN_CLEANLINESS = 0.45

const HOUR_MS = 3_600_000
const WEIGHT_CLAMP_MARGIN = 0.15
const WEIGHT_CARE_MARGIN = 0.1
const NIGHT_START_HOUR = 20
const NIGHT_END_HOUR = 8

const unit = (value: number): number => Math.min(1, Math.max(0, value))

export function createCare(breed: Breed, now: number): Care {
  const { min, max } = breed.weightKg
  return {
    hunger: 0.3,
    cleanliness: 1,
    energy: 0.8,
    happiness: 0.5,
    weightKg: (min + max) / 2,
    wet: 0,
    lastSeen: now,
    bladder: 0,
    messes: [],
    gloom: 0,
    shine: 0,
  }
}

/**
 * A care record saved before pee and poop came along: nothing waiting and an empty bladder; and
 * before brushing, a dull coat.
 */
export const withCareDefaults = (
  stored: Omit<Care, 'bladder' | 'messes' | 'gloom' | 'shine'> & Partial<Care>,
): Care => ({ bladder: 0, messes: [], gloom: 0, shine: 0, ...stored })

export function isNight(now: number): boolean {
  const hour = new Date(now).getHours()
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR
}

/** Where an accident during an absence lands on the floor, or null when there is no room. */
export type PlaceAccident = (
  kind: MessKind,
  taken: readonly Mess[],
) => { x: number; z: number } | null

/** Steps of the walk through an absence, and how far back it looks: two fills come well within. */
const ACCIDENT_STEP_MS = 5 * 60_000
const ACCIDENT_LOOKBACK_MS = 72 * HOUR_MS

/**
 * The time away with the app closed: needs drift within their caps and, by day (asleep it holds
 * on), the bladder fills. Each time it is full the puppy has an accident where `place` says, up
 * to MESS_CAP waiting; past the cap it went in the garden. With nowhere to put one, it waits with
 * a full bladder and goes in the room.
 */
export function catchUp(
  care: Care,
  breed: Breed,
  now: number,
  place?: PlaceAccident,
  random: () => number = Math.random,
): Care {
  const hours = (now - care.lastSeen) / HOUR_MS
  if (hours <= 0) return { ...care, lastSeen: now }
  const accidents = holdOn(care, now, place, random)
  const drift = HAPPINESS_DRIFT_PER_HOUR * hours
  const toward =
    care.happiness > 0.5
      ? Math.max(0.5, care.happiness - drift)
      : Math.min(0.5, care.happiness + drift)
  const drifted: Care = {
    ...care,
    hunger: Math.max(
      care.hunger,
      Math.min(CATCH_UP_MAX_HUNGER, care.hunger + HUNGER_PER_HOUR * hours),
    ),
    cleanliness: Math.min(
      care.cleanliness,
      Math.max(CATCH_UP_MIN_CLEANLINESS, care.cleanliness - CLEANLINESS_LOSS_PER_HOUR * hours),
    ),
    energy: unit(care.energy + ENERGY_REST_PER_HOUR * hours),
    happiness: unit(toward),
    wet: unit(care.wet - WET_LOSS_PER_SECOND * hours * 3600),
    shine: unit(care.shine - SHINE_LOSS_PER_HOUR * hours),
    weightKg: clampWeight(care.weightKg, breed),
    lastSeen: now,
    bladder: accidents.bladder,
  }
  let out = drifted
  for (const mess of accidents.added) out = addMess(out, mess)
  const first = out.messes.reduce((t, m) => Math.min(t, m.createdAt), now)
  return sulk(out, (now - Math.max(first, care.lastSeen)) / 1000)
}

function holdOn(care: Care, now: number, place: PlaceAccident | undefined, random: () => number) {
  let bladder = care.bladder
  const added: Mess[] = []
  for (let t = Math.max(care.lastSeen, now - ACCIDENT_LOOKBACK_MS); t < now;) {
    const step = Math.min(ACCIDENT_STEP_MS, now - t),
      asleep = isNight(t)
    t += step
    if (asleep) continue
    bladder += (BLADDER_PER_HOUR * step) / HOUR_MS
    if (bladder < 1) continue
    if (care.messes.length + added.length >= MESS_CAP) {
      bladder -= 1
      continue
    }
    const kind = messKind(random(), false)
    const at = place?.(kind, [...care.messes, ...added])
    if (!at) {
      bladder = 1
      break
    }
    added.push({ kind, x: at.x, z: at.z, createdAt: t })
    bladder -= 1
  }
  return { bladder: unit(bladder), added }
}

/** Of the cleanliness an absence takes, the share that comes back as dirt in the coat. */
export const ABSENCE_DIRT_SHOWN = 0.5

/**
 * The care a puppy comes back to the room with: `catchUp`, keeping only ABSENCE_DIRT_SHOWN of the
 * cleanliness it lost to time. In the room the coat's dirt is the cleanliness, and days away
 * should read as dusty paws and belly, not mud up the back.
 */
export function comeBack(
  care: Care,
  breed: Breed,
  now: number,
  place?: PlaceAccident,
  random?: () => number,
): Care {
  const back = catchUp(care, breed, now, place, random)
  const lost = care.cleanliness - back.cleanliness - (messPenalty(back) - messPenalty(care))
  if (lost <= 0) return back
  return { ...back, cleanliness: back.cleanliness + lost * (1 - ABSENCE_DIRT_SHOWN) }
}

export function weightStatus(care: Care, breed: Breed): WeightStatus {
  if (care.weightKg < breed.weightKg.min) return 'Un poco flaco'
  if (care.weightKg > breed.weightKg.max) return 'Un poco gordito'
  return 'En su peso'
}

export function health(care: Care, breed: Breed): Health {
  const { min, max } = breed.weightKg
  const farOff =
    care.weightKg < min * (1 - WEIGHT_CARE_MARGIN) || care.weightKg > max * (1 + WEIGHT_CARE_MARGIN)
  if (care.hunger > 0.9 || care.cleanliness < 0.3 || farOff) return 'Necesita cuidados'
  const inRange = care.weightKg >= min && care.weightKg <= max
  if (care.hunger < 0.4 && care.cleanliness > 0.8 && care.happiness > 0.6 && inRange) {
    return 'Muy bien'
  }
  return 'Bien'
}

function clampWeight(weightKg: number, breed: Breed): number {
  const { min, max } = breed.weightKg
  return Math.min(
    max * (1 + WEIGHT_CLAMP_MARGIN),
    Math.max(min * (1 - WEIGHT_CLAMP_MARGIN), weightKg),
  )
}

export function feed(care: Care, breed: Breed, amount = 1): Care {
  return {
    ...care,
    hunger: unit(care.hunger - MEAL_HUNGER * amount),
    bladder: unit(care.bladder + BLADDER_PER_MEAL * Math.min(1, amount)),
    weightKg: clampWeight(care.weightKg + MEAL_WEIGHT_KG * amount, breed),
  }
}

export function exercise(care: Care, seconds: number, breed: Breed): Care {
  return {
    ...care,
    weightKg: clampWeight(care.weightKg - (PLAY_WEIGHT_KG_PER_MINUTE * seconds) / 60, breed),
  }
}

export const soil = (care: Care, amount: number): Care => ({
  ...care,
  cleanliness: unit(care.cleanliness - amount),
})

export const wash = (care: Care, amount: number): Care => ({
  ...care,
  cleanliness: unit(care.cleanliness + amount),
  wet: 1,
})

export const dry = (care: Care, seconds: number): Care => ({
  ...care,
  wet: unit(care.wet - WET_LOSS_PER_SECOND * seconds),
})

/** Brushed: `shine` more gloss and `joy` more happiness. */
export const groom = (care: Care, shine: number, joy: number): Care => ({
  ...care,
  shine: unit(care.shine + shine),
  happiness: unit(care.happiness + joy),
})

/** `seconds` of the shine wearing off; a dull coat is the same care. */
export const dull = (care: Care, seconds: number): Care =>
  care.shine > 0
    ? { ...care, shine: unit(care.shine - (SHINE_LOSS_PER_HOUR * seconds) / 3600) }
    : care

export const getHungry = (care: Care, seconds: number): Care => ({
  ...care,
  hunger: unit(care.hunger + (HUNGER_PER_HOUR * seconds) / 3600),
})

/** Play, petting, a meal or a bath it likes: `amount` more happiness. */
export const cheer = (care: Care, amount: number): Care => ({
  ...care,
  happiness: unit(care.happiness + amount),
})

export const rest = (care: Care, seconds: number): Care => ({
  ...care,
  energy: unit(care.energy + (ENERGY_REST_PER_HOUR * seconds) / 3600),
})

export const tire = (care: Care, seconds: number): Care => ({
  ...care,
  energy: unit(care.energy - (ENERGY_MOVE_LOSS_PER_HOUR * seconds) / 3600),
})

export const fillBladder = (care: Care, seconds: number): Care => ({
  ...care,
  bladder: unit(care.bladder + (BLADDER_PER_HOUR * seconds) / 3600),
})

export const relieve = (care: Care): Care => ({ ...care, bladder: 0 })

/** `chance` is a draw from 0 to 1; a meal in the last half hour makes a poop likelier. */
export const messKind = (chance: number, fedRecently: boolean): MessKind =>
  chance < (fedRecently ? POOP_CHANCE_FED : POOP_CHANCE) ? 'poop' : 'pee'

/** How much the waiting messes take off cleanliness. */
export const messPenalty = (care: Care): number => MESS_CLEANLINESS * care.messes.length

/** A mess on the floor, unless MESS_CAP already wait: then it is the same care. */
export function addMess(care: Care, mess: Mess): Care {
  if (care.messes.length >= MESS_CAP) return care
  return {
    ...soil(care, MESS_CLEANLINESS),
    messes: [...care.messes, mess],
  }
}

/** Cleans `mess` up: the cleanliness it took comes back; with none left, so can a new sulk. */
export function cleanMess(care: Care, mess: Mess): Care {
  const messes = care.messes.filter((m) => m !== mess)
  if (messes.length === care.messes.length) return care
  return {
    ...care,
    cleanliness: unit(care.cleanliness + MESS_CLEANLINESS),
    messes,
    gloom: messes.length ? care.gloom : 0,
  }
}

/** `seconds` with messes waiting: happiness drifts down, MESS_GLOOM_MAX at most until cleaned. */
export function sulk(care: Care, seconds: number): Care {
  if (!care.messes.length || seconds <= 0 || care.gloom >= MESS_GLOOM_MAX) return care
  const take = Math.min(MESS_GLOOM_MAX - care.gloom, (MESS_GLOOM_PER_HOUR * seconds) / 3600)
  return { ...care, happiness: unit(care.happiness - take), gloom: care.gloom + take }
}
