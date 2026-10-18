// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { createCare, type Care } from '@/domain/care'
import { legRigs } from '@/engine/motion/ik'
import {
  createLegStates,
  createMotionState,
  stepLocomotion,
  type LegState,
  type MotionState,
} from '@/engine/motion/locomotion'
import { POSES, stepPoses } from '@/engine/motion/poses'
import {
  approach,
  bedSlots,
  BEG_EVERY,
  createRoutineState,
  followBed,
  forgetRoute,
  keepsEating,
  MEAL_TIME,
  mealSpot,
  stepRoutine,
  touch,
  tuckIn,
  type Routine,
  type RoutineCtx,
  type RoutineState,
} from '@/engine/motion/routine'
import { anatomy } from '@/engine/puppy/anatomy'
import { clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import { separate } from '@/engine/room/crowd'
import { computeSpots, START_PLACES, type Spot, type Spots } from '@/engine/room/furniture'

const DT = 1 / 60
const A = anatomy(BREEDS.shiba)
const cam = fitCamera(createCamera(), 0.46)
const SPOTS = computeSpots(cam, 1),
  SPOTS2 = computeSpots(cam, 2)
const clamp = (x: number, z: number) => clampPlay(cam, x, z)
const at = (h: number, min = 0) => new Date(2026, 9, 18, h, min).getTime()
/** How far ahead of its body a shiba's mouth meets the bowl. */
const MUZZLE = 0.45
const base = { breed: BREEDS.shiba, muzzle: MUZZLE, clamp }

interface Pup {
  r: RoutineState
  m: MotionState
  legs: LegState[]
  care: Care
  /** How full its bowl is. */
  bowl: number
  seen: Routine[]
  /** Seconds spent in each routine. */
  time: Partial<Record<Routine, number>>
  fed: number
}

function pup(x: number, z: number, energy = 0.8, hunger = 0.3, bowl = 0): Pup {
  const m = createMotionState()
  m.pos.set(x, 0, z)
  return {
    r: createRoutineState(),
    m,
    legs: createLegStates(legRigs(A), m),
    care: { ...createCare(BREEDS.shiba, 0), energy, hunger },
    bowl,
    seen: [],
    time: {},
    fed: 0,
  }
}

/**
 * Runs the puppies for `secs` the way the room does: routine, poses, steps, then apart. Each one's
 * place is its index, unless `places` says otherwise.
 */
function run(
  pups: Pup[],
  secs: number,
  now: number,
  spots: Spots = SPOTS,
  each?: () => void,
  places?: number[],
) {
  for (let n = 0; n < secs / DT; n++) {
    for (const [i, p] of pups.entries()) {
      const ctx: RoutineCtx = {
        ...base,
        now: now + n * DT * 1000,
        care: p.care,
        spots,
        place: places?.[i] ?? i,
        bowl: p.bowl,
      }
      const ev = stepRoutine(p.r, p.m, ctx, DT)
      p.care = ev.care
      p.bowl = ev.bowl
      if (ev.fed) p.fed++
      p.time[p.r.routine] = (p.time[p.r.routine] ?? 0) + DT
      if (p.seen.at(-1) !== p.r.routine) p.seen.push(p.r.routine)
      stepPoses(p.m, DT)
      stepLocomotion(p.m, p.legs, DT)
    }
    separate(
      pups.map((p) => p.m),
      0.45,
      clamp,
    )
    each?.()
  }
}

/** Where a point lies in a bed's oval: below 1 is inside. */
const inBed = (m: MotionState, bed: Spot = SPOTS.beds[0]!) => {
  const { center, radius, depth, facing } = bed
  const rx = m.pos.x - center.x,
    rz = m.pos.z - center.z
  const u = (rx * Math.cos(facing) - rz * Math.sin(facing)) / radius,
    v = (rx * Math.sin(facing) + rz * Math.cos(facing)) / depth
  return Math.hypot(u, v)
}

describe('stepRoutine', () => {
  it('sends both puppies to their own beds at 20:00, where they turn round and fall asleep', () => {
    const a = pup(-0.1, 0),
      b = pup(0.35, 0)
    let turned = 0,
      last = a.m.heading
    run([a, b], 40, at(20), SPOTS2, () => {
      if (a.r.routine === 'toBed') turned += Math.abs(a.m.heading - last)
      last = a.m.heading
    })
    ;[a, b].forEach((p, i) => {
      const bed = SPOTS2.beds[i]!
      expect(p.seen).toEqual(['toBed', 'sleeping'])
      expect(p.m.pose).toBe('sleep')
      expect(inBed(p.m, bed)).toBeLessThan(0.25)
      expect(Math.hypot(p.m.pos.x - bed.center.x, p.m.pos.z - bed.center.z)).toBeLessThan(0.1)
    })
    expect([a.m.sleepSide, b.m.sleepSide]).toEqual([-1, 1])
    expect(turned).toBeGreaterThan(Math.PI * 2 - 0.3)
  })

  it('goes to the bed of its place in the room, wherever it starts', () => {
    const a = pup(0.35, 0),
      b = pup(-0.1, 0)
    run([a, b], 50, at(20), SPOTS2, undefined, [0, 1])
    expect(inBed(a.m, SPOTS2.beds[0]!)).toBeLessThan(0.25)
    expect(inBed(b.m, SPOTS2.beds[1]!)).toBeLessThan(0.25)
    expect([a.r.routine, b.r.routine]).toEqual(['sleeping', 'sleeping'])
  })

  it('left alone, a sleeper is carried to the one bed and one on its way heads there', () => {
    const body = (p: Pup) => [p.m.pos, ...p.legs.flatMap((L) => [L.planted, L.from, L.land, L.pos])]
    const move = (p: Pup, from: Spot, to: Spot) => {
      forgetRoute(p.r, p.m)
      followBed(p.r, body(p), to.center.x - from.center.x, to.center.z - from.center.z)
    }
    const one = SPOTS.beds[0]!
    // Asleep in the right-hand bed when the left-hand puppy leaves
    const a = pup(-0.1, 0),
      b = pup(0.35, 0)
    run([a, b], 40, at(20), SPOTS2)
    expect(b.r.routine).toBe('sleeping')
    move(b, SPOTS2.beds[1]!, one)
    expect(b.r.routine).toBe('sleeping')
    expect(inBed(b.m, one)).toBeLessThan(0.25)
    run([b], 2, at(20, 1), SPOTS)
    expect(b.r.routine).toBe('sleeping')
    // On the way there
    const c = pup(-0.1, 0),
      d = pup(0.35, 0)
    run([c, d], 1, at(20), SPOTS2)
    expect(d.r.routine).toBe('toBed')
    move(d, SPOTS2.beds[1]!, one)
    expect([d.r.routine, d.m.goal]).toEqual(['none', null])
    run([d], 40, at(20, 1), SPOTS)
    expect(d.seen.slice(-2)).toEqual(['toBed', 'sleeping'])
    expect(inBed(d.m, one)).toBeLessThan(0.25)
  })

  it('walks round furniture in the way, but not round the bed it is going to', () => {
    const p = pup(-0.2, -0.3)
    const bed = SPOTS.beds[0]!.center,
      bowl = SPOTS.bowls[0]!
    const mid = { x: (p.m.pos.x + bed.x) / 2, z: (p.m.pos.z + bed.z) / 2 }
    const spots: Spots = {
      ...SPOTS,
      bowls: [{ ...bowl, center: bowl.center.clone().set(mid.x, 0, mid.z) }],
    }
    let nearest = Infinity
    run([p], 30, at(21), spots, () => {
      nearest = Math.min(nearest, Math.hypot(p.m.pos.x - mid.x, p.m.pos.z - mid.z))
    })
    expect(nearest).toBeGreaterThan(bowl.radius)
    expect(p.r.routine).toBe('sleeping')
  })

  it('stretches when touched asleep, then stays up until 90 s pass without a touch at night', () => {
    const p = pup(0, 0)
    run([p], 40, at(22))
    expect(p.r.routine).toBe('sleeping')
    let yawns = 0,
      bowed = 0
    expect(touch(p.r)).toBe(true)
    for (let n = 0; n < 1.6 / DT; n++) {
      const ev = stepRoutine(
        p.r,
        p.m,
        { ...base, now: at(22, 1), care: p.care, spots: SPOTS, place: 0, bowl: 0 },
        DT,
      )
      if (ev.yawn) yawns++
      bowed = Math.max(bowed, p.m.bowGoal)
      if (p.seen.at(-1) !== p.r.routine) p.seen.push(p.r.routine)
      stepPoses(p.m, DT)
      stepLocomotion(p.m, p.legs, DT)
    }
    expect(p.seen.slice(-2)).toEqual(['stretch', 'none'])
    expect([yawns, bowed]).toEqual([1, 1])
    expect(p.m.pose).toBe('stand')
    run([p], 88, at(22, 2))
    expect(p.r.routine).toBe('none')
    run([p], 6, at(22, 4))
    expect(p.seen.slice(-3)).toEqual(['none', 'toBed', 'sleeping'])
  })

  it('by day sleeps only when tired, and wakes by itself once rested', () => {
    const tired = pup(0, 0, 0.1),
      fresh = pup(0.3, 0, 0.9)
    run([tired], 40, at(12))
    run([fresh], 40, at(12))
    expect(tired.r.routine).toBe('sleeping')
    expect(fresh.seen).toEqual(['none'])
    tired.care = { ...tired.care, energy: 0.85 }
    run([tired], 1, at(13))
    expect(tired.r.routine).toBe('sleeping')
    tired.care = { ...tired.care, energy: 0.9 }
    run([tired], 2, at(13))
    expect(tired.seen.slice(-2)).toEqual(['stretch', 'none'])
  })

  it('rests asleep and tires slowly while walking about', () => {
    const p = pup(0, 0, 0.5)
    tuckIn(p.r, p.m)
    const ctx = { ...base, now: at(23), care: p.care, spots: SPOTS, place: 0, bowl: 0 }
    expect(stepRoutine(p.r, p.m, ctx, 3600).care.energy).toBeCloseTo(0.75)
    const awake = pup(0, 0, 0.5)
    awake.m.speed = 0.3
    const day = { ...ctx, now: at(12), care: awake.care }
    expect(stepRoutine(awake.r, awake.m, day, 60).care.energy).toBeLessThan(0.5)
    awake.m.speed = 0
    expect(stepRoutine(awake.r, awake.m, day, 60).care.energy).toBe(0.5)
  })

  it('gives way to play: a busy puppy leaves the bed and starts counting again', () => {
    const p = pup(0, 0)
    tuckIn(p.r, p.m)
    stepRoutine(
      p.r,
      p.m,
      { ...base, now: at(23), care: p.care, spots: SPOTS, place: 0, bowl: 0, busy: true },
      DT,
    )
    expect([p.r.routine, p.r.idle]).toEqual(['none', 0])
  })

  it('wakes when something else stands it up', () => {
    const p = pup(0, 0)
    tuckIn(p.r, p.m)
    p.m.pose = 'stand'
    stepRoutine(
      p.r,
      p.m,
      { ...base, now: at(23), care: p.care, spots: SPOTS, place: 0, bowl: 0 },
      DT,
    )
    expect(p.r.routine).toBe('none')
    expect(touch(p.r)).toBe(false)
  })
})

describe('meals', () => {
  /** Distance from the body to where it stands to eat from bowl `i`. */
  const offMeal = (p: Pup, spots: Spots, i: number) => {
    const s = mealSpot(spots.bowls[i]!, MUZZLE)
    return Math.hypot(p.m.pos.x - s.x, p.m.pos.z - s.z)
  }
  const turn = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)))

  it('walks a hungry puppy to its full bowl, where it eats for 4 s facing it and gets fed', () => {
    const p = pup(0.12, -0.12, 0.8, 0.8, 1)
    const kg = p.care.weightKg
    let facing = Infinity,
      near = Infinity
    run([p], 20, at(12), SPOTS, () => {
      if (p.r.routine !== 'eating') return
      near = Math.min(near, -offMeal(p, SPOTS, 0))
      facing = Math.min(facing, -turn(p.m.heading - SPOTS.bowls[0]!.facing))
    })
    expect(p.seen).toEqual(['toBowl', 'eating', 'none'])
    expect(p.time.eating).toBeCloseTo(MEAL_TIME, 1)
    expect(MEAL_TIME).toBe(4)
    expect(-near).toBeLessThan(0.07)
    expect(-facing).toBeLessThan(0.1)
    expect(p.care.hunger).toBeLessThanOrEqual(0.2)
    expect(p.care.weightKg).toBeGreaterThan(kg)
    expect(p.care.weightKg).toBeLessThan(kg + 0.03)
    expect([p.bowl, p.fed, p.m.pose]).toEqual([0, 1, 'stand'])
  })

  it('empties the bowl bit by bit and feeds only once the meal is done', () => {
    const p = pup(0.12, -0.12, 0.8, 0.8, 1)
    const halfway: number[] = []
    run([p], 20, at(12), SPOTS, () => {
      if (p.r.routine === 'eating' && Math.abs(p.r.t - MEAL_TIME / 2) < DT / 2)
        halfway.push(p.bowl, p.care.hunger)
    })
    expect(halfway[0]).toBeCloseTo(0.5, 1)
    expect(halfway[1]).toBe(0.8)
  })

  it('with two, each eats from its own bowl', () => {
    const [l, r] = START_PLACES[1]!
    const a = pup(l!.x, l!.z, 0.8, 0.8, 1),
      b = pup(r!.x, r!.z, 0.8, 0.5, 1)
    const worst = [0, 0]
    run([a, b], 20, at(12), SPOTS2, () => {
      ;[a, b].forEach((p, i) => {
        if (p.r.routine === 'eating') worst[i] = Math.max(worst[i]!, offMeal(p, SPOTS2, i))
      })
    })
    ;[a, b].forEach((p, i) => {
      expect(p.seen).toEqual(['toBowl', 'eating', 'none'])
      expect(p.bowl).toBe(0)
      expect(worst[i]).toBeLessThan(0.07)
    })
    expect(a.care.hunger).toBeCloseTo(0.1)
    expect(b.care.hunger).toBe(0)
  })

  it('leaves the food when it is not hungry', () => {
    const p = pup(0.12, -0.12, 0.8, 0.2, 1)
    run([p], 10, at(12))
    expect([p.seen, p.bowl]).toEqual([['none'], 1])
  })

  it('with its bowl empty and hungry, sits by it looking up, and asks again only after 30 s', () => {
    const p = pup(0.12, -0.12, 0.8, 0.8, 0)
    let sat = 0
    run([p], 12, at(12), SPOTS, () => {
      if (p.r.routine === 'begging' && p.m.pose === 'sit') sat += DT
      if (p.r.routine === 'begging') expect(offMeal(p, SPOTS, 0)).toBeLessThan(0.07)
    })
    expect(p.seen).toEqual(['toBowl', 'begging', 'none'])
    expect(sat).toBeGreaterThan(2)
    // From the moment it gave up asking
    const asked = p.time.none!
    run([p], BEG_EVERY - asked - 0.5, at(12, 1))
    expect(p.seen.slice(-1)).toEqual(['none'])
    run([p], 1, at(12, 2))
    // Still by the bowl, it asks again at once
    expect(p.seen.slice(-3)).toEqual(['none', 'toBowl', 'begging'])
  })

  it('goes to eat as soon as its bowl is filled while it begs', () => {
    const p = pup(0.12, -0.12, 0.8, 0.8, 0)
    run([p], 5, at(12))
    expect(p.r.routine).toBe('begging')
    p.bowl = 1
    run([p], 10, at(12, 1))
    expect(p.seen.slice(-3)).toEqual(['toBowl', 'eating', 'none'])
    expect(p.care.hunger).toBeCloseTo(0.1)
  })

  it('eats before bed: at night with a full bowl it eats, then goes to sleep', () => {
    const p = pup(0.12, -0.12, 0.8, 0.5, 1)
    run([p], 50, at(21))
    expect(p.seen).toEqual(['toBowl', 'eating', 'none', 'toBed', 'sleeping'])
  })

  it('a ball keeps a very hungry puppy eating; one only a little hungry stops and plays', () => {
    const p = pup(0.12, -0.12, 0.8, 0.8, 1)
    for (let n = 0; n < 20 / DT && p.r.routine !== 'eating'; n++) run([p], DT, at(12))
    run([p], 0.5, at(12))
    expect(p.r.routine).toBe('eating')
    const play = (q: Pup) =>
      stepRoutine(
        q.r,
        q.m,
        { ...base, now: at(12), care: q.care, spots: SPOTS, place: 0, bowl: q.bowl, busy: true },
        DT,
      )
    expect(keepsEating(p.r, p.care)).toBe(true)
    let ev = play(p)
    expect(p.r.routine).toBe('eating')
    p.bowl = ev.bowl
    p.care = { ...ev.care, hunger: 0.2 }
    expect(keepsEating(p.r, p.care)).toBe(false)
    ev = play(p)
    expect(p.r.routine).toBe('none')
    // What it ate before it stopped still counts
    expect(ev.bowl).toBeGreaterThan(0.7)
    expect(ev.bowl).toBeLessThan(0.95)
    expect(ev.care.hunger).toBeCloseTo(0.2 - 0.7 * (1 - ev.bowl), 3)
  })
})

describe('approach', () => {
  it('walks to the target and says so once there and still', () => {
    const p = pup(0, 0)
    p.r.target.set(0.5, 0, 0.2)
    const ctx: RoutineCtx = { ...base, now: at(12), care: p.care, spots: SPOTS, place: 0, bowl: 0 }
    let there = false
    for (let n = 0; n < 20 / DT && !there; n++) {
      there = approach(p.r, p.m, ctx, SPOTS.bowls[0]!)
      stepPoses(p.m, DT)
      stepLocomotion(p.m, p.legs, DT)
    }
    expect(there).toBe(true)
    expect(Math.hypot(p.m.pos.x - 0.5, p.m.pos.z - 0.2)).toBeLessThan(0.06)
  })
})

describe('bedSlots', () => {
  it('puts each puppy in the middle of its own bed, left first, inside the play area', () => {
    const [one] = bedSlots(SPOTS)
    const bed = SPOTS.beds[0]!
    expect(Math.hypot(one!.x - bed.center.x, one!.z - bed.center.z)).toBeLessThan(1e-9)
    expect(one!.heading).toBeCloseTo(bed.facing)
    const [l, r] = bedSlots(SPOTS2)
    expect(Math.hypot(l!.x - r!.x, l!.z - r!.z)).toBeGreaterThanOrEqual(0.45)
    expect(playLocal(cam, l!.x, l!.z).side).toBeLessThan(playLocal(cam, r!.x, r!.z).side)
    // Each curls its head outwards, so neither hides the other
    expect([one!.side, l!.side, r!.side]).toEqual([1, -1, 1])
    ;[l!, r!].forEach((s, i) => {
      const [x, z] = clamp(s.x, s.z)
      expect(Math.hypot(x - s.x, z - s.z)).toBeLessThan(1e-9)
      const m = createMotionState()
      m.pos.set(s.x, 0, s.z)
      expect(inBed(m, SPOTS2.beds[i]!)).toBeLessThan(1e-9)
    })
  })
})

describe('tuckIn', () => {
  it('starts a puppy already curled up asleep', () => {
    const p = pup(0, 0)
    tuckIn(p.r, p.m)
    expect([p.r.routine, p.m.pose, p.m.fk, p.m.sleepW]).toEqual(['sleeping', 'sleep', 1, 1])
    expect(p.m.legPose[0]).toEqual(POSES.sleep.front)
  })
})
