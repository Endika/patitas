import { describe, expect, it } from 'vitest'
import { BREEDS } from '../../src/domain/breeds'
import {
  catchUp,
  createCare,
  dry,
  exercise,
  feed,
  health,
  isNight,
  rest,
  soil,
  wash,
  weightStatus,
  type Care,
} from '../../src/domain/care'

const at = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min).getTime()
const HOUR = 3_600_000
const breed = BREEDS.shiba

const inUnit = (care: Care) =>
  [care.hunger, care.cleanliness, care.energy, care.happiness, care.wet].every(
    (value) => value >= 0 && value <= 1,
  )

describe('breed weight ranges', () => {
  it('uses the agreed ranges', () => {
    expect(BREEDS.dorado.weightKg).toEqual({ min: 9, max: 13 })
    expect(BREEDS.shiba.weightKg).toEqual({ min: 3.5, max: 5 })
    expect(BREEDS.beagle.weightKg).toEqual({ min: 4, max: 6.5 })
  })
})

describe('createCare', () => {
  it('starts at the centre of the weight range, fed and clean', () => {
    expect(createCare(breed, 42)).toEqual({
      hunger: 0.3,
      cleanliness: 1,
      energy: 0.8,
      happiness: 0.5,
      weightKg: 4.25,
      wet: 0,
      lastSeen: 42,
    })
  })
})

describe('isNight', () => {
  it('is night from 20:00 to 8:00 local', () => {
    expect(isNight(at(1, 19, 59))).toBe(false)
    expect(isNight(at(1, 20, 0))).toBe(true)
    expect(isNight(at(1, 7, 59))).toBe(true)
    expect(isNight(at(1, 8, 0))).toBe(false)
  })
})

describe('catchUp', () => {
  const start = at(1, 12)

  it.each([3, 30])('never leaves the puppy needing care after %i days away', (days) => {
    for (const b of Object.values(BREEDS)) {
      const care = catchUp(createCare(b, start), b, start + days * 24 * HOUR)
      expect(care.hunger).toBeLessThanOrEqual(0.85)
      expect(care.cleanliness).toBeGreaterThanOrEqual(0.45)
      expect(health(care, b)).not.toBe('Necesita cuidados')
      expect(inUnit(care)).toBe(true)
    }
  })

  it('gets hungry but not starving over 3 days', () => {
    const care = catchUp(createCare(breed, start), breed, start + 72 * HOUR)
    expect(care.hunger).toBeGreaterThanOrEqual(0.7)
    expect(care.lastSeen).toBe(start + 72 * HOUR)
  })

  it('applies the hourly rates over a short absence', () => {
    const care = catchUp(createCare(breed, start), breed, start + HOUR)
    expect(care.hunger).toBeCloseTo(0.42)
    expect(care.cleanliness).toBeCloseTo(0.98)
    expect(care.energy).toBeCloseTo(1)
    expect(care.happiness).toBeCloseTo(0.5)
  })

  it('drifts happiness toward one half and dries the coat', () => {
    const base = { ...createCare(breed, start), happiness: 1, wet: 1 }
    const care = catchUp(base, breed, start + 2 * HOUR)
    expect(care.happiness).toBeCloseTo(0.9)
    expect(care.wet).toBe(0)
    const sad = catchUp({ ...base, happiness: 0 }, breed, start + 2 * HOUR)
    expect(sad.happiness).toBeCloseTo(0.1)
  })

  it('does not improve a need that was already past its cap', () => {
    const base = { ...createCare(breed, start), hunger: 0.95, cleanliness: 0.2 }
    const care = catchUp(base, breed, start + 10 * HOUR)
    expect(care.hunger).toBe(0.95)
    expect(care.cleanliness).toBe(0.2)
  })

  it('only moves lastSeen when it is in the future', () => {
    const base = createCare(breed, start + 5 * HOUR)
    const care = catchUp(base, breed, start)
    expect(care).toEqual({ ...base, lastSeen: start })
    expect(inUnit(care)).toBe(true)
  })
})

describe('weightStatus', () => {
  const withWeight = (weightKg: number) => ({ ...createCare(breed, 0), weightKg })

  it('is on the edges of the range inclusive', () => {
    expect(weightStatus(withWeight(3.49), breed)).toBe('Un poco flaco')
    expect(weightStatus(withWeight(3.5), breed)).toBe('En su peso')
    expect(weightStatus(withWeight(5), breed)).toBe('En su peso')
    expect(weightStatus(withWeight(5.01), breed)).toBe('Un poco gordito')
  })
})

describe('health', () => {
  const base = { ...createCare(breed, 0), hunger: 0.2, cleanliness: 0.9, happiness: 0.8 }

  it('is Muy bien when everything is comfortable', () => {
    expect(health(base, breed)).toBe('Muy bien')
  })

  it('is Bien in between', () => {
    expect(health({ ...base, hunger: 0.5 }, breed)).toBe('Bien')
    expect(health({ ...base, weightKg: 5.1 }, breed)).toBe('Bien')
  })

  it('needs care when hungry, dirty or far from the weight range', () => {
    expect(health({ ...base, hunger: 0.91 }, breed)).toBe('Necesita cuidados')
    expect(health({ ...base, cleanliness: 0.29 }, breed)).toBe('Necesita cuidados')
    expect(health({ ...base, weightKg: 5.6 }, breed)).toBe('Necesita cuidados')
    expect(health({ ...base, weightKg: 3.1 }, breed)).toBe('Necesita cuidados')
  })
})

describe('actions', () => {
  const care = createCare(breed, 0)

  it('feed lowers hunger and adds 0.02 kg per meal', () => {
    const fed = feed({ ...care, hunger: 0.8 }, 1, breed)
    expect(fed.hunger).toBeCloseTo(0.3)
    expect(fed.weightKg).toBeCloseTo(4.27)
    expect(feed({ ...care, hunger: 0.1 }, 1, breed).hunger).toBe(0)
  })

  it('exercise removes 0.004 kg per minute and never goes below the floor', () => {
    expect(exercise(care, 600, breed).weightKg).toBeCloseTo(4.21)
    expect(exercise({ ...care, weightKg: 3 }, 6000, breed).weightKg).toBeCloseTo(2.975)
    expect(feed({ ...care, weightKg: 5.7 }, 5, breed).weightKg).toBeCloseTo(5.75)
  })

  it('soil, wash and dry move cleanliness and wetness inside [0, 1]', () => {
    expect(soil(care, 0.4).cleanliness).toBeCloseTo(0.6)
    expect(soil(care, 5).cleanliness).toBe(0)
    const washed = wash({ ...care, cleanliness: 0.5 }, 0.3)
    expect(washed.cleanliness).toBeCloseTo(0.8)
    expect(washed.wet).toBe(1)
    expect(wash(care, 2).cleanliness).toBe(1)
    expect(dry(washed, 30).wet).toBeCloseTo(0.5)
    expect(dry(washed, 600).wet).toBe(0)
  })

  it('rest recovers a quarter of the energy per hour', () => {
    expect(rest({ ...care, energy: 0.2 }, 3600).energy).toBeCloseTo(0.45)
    expect(rest(care, 36000).energy).toBe(1)
  })
})
