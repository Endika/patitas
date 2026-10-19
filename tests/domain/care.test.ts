import { describe, expect, it } from 'vitest'
import { BREEDS } from '../../src/domain/breeds'
import {
  addMess,
  BLADDER_PER_HOUR,
  catchUp,
  cheer,
  cleanMess,
  comeBack,
  getHungry,
  settle,
  createCare,
  fillBladder,
  messKind,
  MESS_CAP,
  relieve,
  sulk,
  withCareDefaults,
  dry,
  dull,
  ENERGY_MOVE_LOSS_PER_HOUR,
  exercise,
  feed,
  groom,
  health,
  isNight,
  rest,
  soil,
  tire,
  wash,
  weightStatus,
  type Care,
  type Mess,
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
      bladder: 0,
      messes: [],
      gloom: 0,
      shine: 0,
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
    const fed = feed({ ...care, hunger: 0.8 }, breed)
    expect(fed.hunger).toBeCloseTo(0.1)
    expect(fed.weightKg).toBeCloseTo(4.27)
    expect(feed({ ...care, hunger: 0.1 }, breed).hunger).toBe(0)
  })

  it('exercise removes 0.004 kg per minute and never goes below the floor', () => {
    expect(exercise(care, 600, breed).weightKg).toBeCloseTo(4.21)
    expect(exercise({ ...care, weightKg: 3 }, 6000, breed).weightKg).toBeCloseTo(2.975)
    expect(feed({ ...care, weightKg: 5.7 }, breed, 5).weightKg).toBeCloseTo(5.75)
  })

  it('soil, wash and dry move cleanliness and wetness inside [0, 1]', () => {
    expect(soil(care, 0.4).cleanliness).toBeCloseTo(0.6)
    expect(soil(care, 5).cleanliness).toBe(0)
    const washed = wash({ ...care, cleanliness: 0.5 }, 0.3)
    expect(washed.cleanliness).toBeCloseTo(0.8)
    expect(washed.wet).toBe(1)
    expect(wash(care, 2).cleanliness).toBe(1)
    // Left alone it dries in about 10 min
    expect(dry(washed, 300).wet).toBeCloseTo(0.5)
    expect(dry(washed, 600).wet).toBe(0)
  })

  it('rest recovers a quarter of the energy per hour', () => {
    expect(rest({ ...care, energy: 0.2 }, 3600).energy).toBeCloseTo(0.45)
    expect(rest(care, 36000).energy).toBe(1)
  })

  it('tire spends energy slowly while the puppy moves about', () => {
    expect(tire({ ...care, energy: 0.8 }, 3600).energy).toBeCloseTo(0.8 - ENERGY_MOVE_LOSS_PER_HOUR)
    expect(tire(care, 360000).energy).toBe(0)
  })
})

describe('pee and poop', () => {
  const care = createCare(breed, 0)
  const mess = (kind: Mess['kind'] = 'pee', createdAt = 0): Mess => ({
    kind,
    x: 0,
    z: 0,
    createdAt,
  })

  it('fills the bladder by the hour and a little more after a meal, and empties it', () => {
    expect(fillBladder(care, 3600).bladder).toBeCloseTo(BLADDER_PER_HOUR)
    expect(fillBladder(care, 36000).bladder).toBe(1)
    expect(feed(care, breed).bladder).toBeCloseTo(0.3)
    expect(relieve({ ...care, bladder: 1 }).bladder).toBe(0)
  })

  it('is poop a third of the time, more often soon after a meal', () => {
    expect(messKind(0.34, false)).toBe('poop')
    expect(messKind(0.36, false)).toBe('pee')
    expect(messKind(0.59, true)).toBe('poop')
    expect(messKind(0.61, true)).toBe('pee')
  })

  it('each mess left lowers cleanliness a little, and cleaning it gives it back', () => {
    const one = addMess(care, mess())
    const two = addMess(one, mess('poop'))
    expect(two.messes).toHaveLength(2)
    expect(two.cleanliness).toBeCloseTo(0.94)
    const cleaned = cleanMess(two, two.messes[0]!)
    expect(cleaned.messes).toEqual([two.messes[1]])
    expect(cleaned.cleanliness).toBeCloseTo(0.97)
  })

  it('keeps at most two per puppy', () => {
    const full = addMess(addMess(care, mess()), mess())
    expect(addMess(full, mess('poop'))).toBe(full)
    expect(MESS_CAP).toBe(2)
  })

  it('while a mess waits, happiness drifts down by at most 0.1, and only while it waits', () => {
    const messy = addMess({ ...care, happiness: 0.8 }, mess())
    expect(sulk(messy, 60).happiness).toBeLessThan(0.8)
    expect(sulk(messy, 60).happiness).toBeGreaterThan(0.7)
    const long = sulk(sulk(messy, 3600), 3600)
    expect(long.happiness).toBeCloseTo(0.7)
    expect(sulk(care, 3600)).toBe(care)
    // Cleaned up, a new mess can sadden it again, but never by more than 0.1 at a time
    const again = sulk(addMess(cleanMess(long, long.messes[0]!), mess()), 3600)
    expect(again.happiness).toBeCloseTo(0.6)
  })

  it('reads an older record without the new fields as empty', () => {
    const { bladder: _b, messes: _m, gloom: _g, shine: _s, ...old } = care
    expect(withCareDefaults(old)).toEqual(care)
    expect(withCareDefaults(addMess(care, mess()))).toEqual(addMess(care, mess()))
  })
})

describe('catchUp with accidents', () => {
  const start = at(1, 12)
  const spots = [0.1, 0.2, 0.3]
  let n = 0
  const place = () => ({ x: spots[n++ % spots.length]!, z: 0.5 })

  it('leaves at most two messes after 8 h by day, placed where it is told', () => {
    n = 0
    const care = catchUp(createCare(breed, start), breed, start + 8 * HOUR, place, () => 0.9)
    expect(care.messes).toHaveLength(2)
    expect(care.messes.map((m) => [m.kind, m.x, m.z])).toEqual([
      ['pee', 0.1, 0.5],
      ['pee', 0.2, 0.5],
    ])
    expect(care.messes.every((m) => m.createdAt > start && m.createdAt <= start + 8 * HOUR)).toBe(
      true,
    )
    expect(care.bladder).toBeLessThan(1)
    expect(care.happiness).toBeGreaterThanOrEqual(0.4 - 1e-9)
    expect(health(care, breed)).not.toBe('Necesita cuidados')
  })

  it('never more than two in all, counting those already there', () => {
    n = 0
    const before = addMess(createCare(breed, start), {
      kind: 'poop',
      x: 0,
      z: 0,
      createdAt: start,
    })
    const care = catchUp(before, breed, start + 30 * 24 * HOUR, place, () => 0.1)
    expect(care.messes).toHaveLength(2)
    expect(care.messes[1]!.kind).toBe('poop')
  })

  it('holds on overnight: asleep the bladder does not fill', () => {
    const night = at(1, 21)
    const care = catchUp(createCare(breed, night), breed, night + 12 * HOUR, place)
    expect(care.messes).toEqual([])
    expect(care.bladder).toBeCloseTo(BLADDER_PER_HOUR)
  })

  it('without anywhere to put them, it keeps the bladder full for the room', () => {
    const care = catchUp(createCare(breed, start), breed, start + 8 * HOUR)
    expect(care.messes).toEqual([])
    expect(care.bladder).toBe(1)
  })
})

describe('shine', () => {
  const start = at(1, 12)

  it('brushing raises the shine and happiness, never past 1', () => {
    const care = createCare(breed, start)
    const brushed = groom(care, 0.3, 0.1)
    expect([brushed.shine, brushed.happiness]).toEqual([0.3, 0.6])
    expect(groom(brushed, 2, 2)).toMatchObject({ shine: 1, happiness: 1 })
  })

  it('fades over about a day, in the room and away', () => {
    const shiny = { ...createCare(breed, start), shine: 1 }
    expect(dull(shiny, 6 * 3600).shine).toBeCloseTo(0.75)
    expect(dull(dull(shiny, 30 * 3600), 1).shine).toBe(0)
    expect(catchUp(shiny, breed, start + 12 * HOUR).shine).toBeCloseTo(0.5)
    expect(catchUp(shiny, breed, start + 3 * 24 * HOUR).shine).toBe(0)
  })

  it('a dull coat stays the same care', () => {
    const care = createCare(breed, start)
    expect(dull(care, 3600)).toBe(care)
  })
})

describe('in the room', () => {
  it('gets hungry by the hour, up to 1', () => {
    const care = { ...createCare(breed, 0), hunger: 0.3 }
    expect(getHungry(care, 3600).hunger).toBeCloseTo(0.42)
    expect(getHungry({ ...care, hunger: 0.99 }, 3600).hunger).toBe(1)
  })

  it('settles toward one half as catchUp does, from either side, without overshooting', () => {
    const care = createCare(breed, 0)
    expect(settle({ ...care, happiness: 1 }, 3600).happiness).toBeCloseTo(0.95)
    expect(settle({ ...care, happiness: 0.2 }, 3600).happiness).toBeCloseTo(0.25)
    expect(settle({ ...care, happiness: 0.52 }, 3600).happiness).toBe(0.5)
    expect(settle({ ...care, happiness: 1 }, 3600).happiness).toBeCloseTo(
      catchUp({ ...care, happiness: 1 }, breed, HOUR).happiness,
    )
  })

  it('cheers up with play, never past 1', () => {
    const care = { ...createCare(breed, 0), happiness: 0.5 }
    expect(cheer(care, 0.1).happiness).toBeCloseTo(0.6)
    expect(cheer(care, 2).happiness).toBe(1)
  })

  it('above one half, each gain shrinks with the room left, the brush too', () => {
    const care = createCare(breed, 0)
    expect(cheer({ ...care, happiness: 0.3 }, 0.1).happiness).toBeCloseTo(0.4)
    expect(cheer({ ...care, happiness: 0.75 }, 0.1).happiness).toBeCloseTo(0.8)
    expect(cheer({ ...care, happiness: 0.9 }, 0.1).happiness).toBeCloseTo(0.92)
    expect(groom({ ...care, happiness: 0.9 }, 0, 0.1).happiness).toBeCloseTo(0.92)
  })
})

describe('comeBack', () => {
  const place = () => ({ x: 0, z: 0.5 })

  it('after 3 days shows half the lost cleanliness as dirt, and health stays Bien or better', () => {
    const left = { ...createCare(breed, at(15, 12)), hunger: 0.2 }
    const back = comeBack(left, breed, at(18, 12), place, () => 0.9)
    const away = catchUp(left, breed, at(18, 12), place, () => 0.9)
    expect(back.hunger).toBeCloseTo(away.hunger)
    expect(back.messes).toEqual(away.messes)
    expect(back.messes).toHaveLength(2)
    const drift = 1 - (away.cleanliness + 0.06)
    expect(drift).toBeCloseTo(0.55)
    expect(back.cleanliness).toBeCloseTo(1 - drift / 2 - 0.06)
    expect(health(back, breed)).toBe('Bien')
  })

  it('a short absence takes off half the hourly cleanliness, and a cleaner coat stays as it was', () => {
    const left = { ...createCare(breed, at(15, 22)), cleanliness: 0.9 }
    expect(comeBack(left, breed, at(15, 23)).cleanliness).toBeCloseTo(0.89)
    const muddy = { ...left, cleanliness: 0.4 }
    expect(comeBack(muddy, breed, at(15, 23)).cleanliness).toBe(0.4)
  })
})
