import type { Breed } from './breeds'

export interface Care {
  hunger: number
  cleanliness: number
  energy: number
  happiness: number
  weightKg: number
  wet: number
  lastSeen: number
}

export type Health = 'Muy bien' | 'Bien' | 'Necesita cuidados'
export type WeightStatus = 'Un poco flaco' | 'En su peso' | 'Un poco gordito'

export const HUNGER_PER_HOUR = 0.12
export const CLEANLINESS_LOSS_PER_HOUR = 0.02
export const ENERGY_REST_PER_HOUR = 0.25
export const ENERGY_MOVE_LOSS_PER_HOUR = 0.3
export const HAPPINESS_DRIFT_PER_HOUR = 0.05
export const WET_LOSS_PER_SECOND = 1 / 60
export const MEAL_WEIGHT_KG = 0.02
export const PLAY_WEIGHT_KG_PER_MINUTE = 0.004
export const MEAL_HUNGER = 0.7

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
  }
}

export function isNight(now: number): boolean {
  const hour = new Date(now).getHours()
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR
}

export function catchUp(care: Care, breed: Breed, now: number): Care {
  const hours = (now - care.lastSeen) / HOUR_MS
  if (hours <= 0) return { ...care, lastSeen: now }
  const drift = HAPPINESS_DRIFT_PER_HOUR * hours
  const toward =
    care.happiness > 0.5
      ? Math.max(0.5, care.happiness - drift)
      : Math.min(0.5, care.happiness + drift)
  return {
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
    weightKg: clampWeight(care.weightKg, breed),
    lastSeen: now,
  }
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

export const rest = (care: Care, seconds: number): Care => ({
  ...care,
  energy: unit(care.energy + (ENERGY_REST_PER_HOUR * seconds) / 3600),
})

export const tire = (care: Care, seconds: number): Care => ({
  ...care,
  energy: unit(care.energy - (ENERGY_MOVE_LOSS_PER_HOUR * seconds) / 3600),
})
