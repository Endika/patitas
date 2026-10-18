// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { addMess, createCare, MESS_GLOOM_MAX, type Care, type MessKind } from '@/domain/care'
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
  MUD_EVERY,
  RELIEF_TIME,
  relieveNow,
  SPLASH_TIME,
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
import { computeSpots, inMud, START_PLACES, type Spot, type Spots } from '@/engine/room/furniture'

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
  /** What it left on the floor, in world coordinates, as the room keeps it. */
  left: { kind: MessKind; x: number; z: number }[]
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
    left: [],
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
  more: Partial<RoutineCtx> = {},
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
        ...more,
      }
      const ev = stepRoutine(p.r, p.m, ctx, DT)
      p.care = ev.care
      p.bowl = ev.bowl
      if (ev.fed) p.fed++
      if (ev.mess) {
        p.left.push({ ...ev.mess })
        p.care = addMess(p.care, { ...ev.mess, createdAt: ctx.now })
      }
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
    expect(-near).toBeLessThan(0.03)
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
      expect(worst[i]).toBeLessThan(0.03)
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
      if (p.r.routine === 'begging') expect(offMeal(p, SPOTS, 0)).toBeLessThan(0.03)
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

  it('keeps the pause after a beg that play cut short', () => {
    const p = pup(0.12, -0.12, 0.8, 0.8, 0)
    run([p], 5, at(12))
    expect(p.r.routine).toBe('begging')
    stepRoutine(
      p.r,
      p.m,
      { ...base, now: at(12), care: p.care, spots: SPOTS, place: 0, bowl: 0, busy: true },
      DT,
    )
    expect(p.r.routine).toBe('none')
    const before = p.seen.length
    run([p], BEG_EVERY - 6, at(12, 1))
    expect(p.seen.slice(before)).toEqual(['none'])
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

describe('mud', () => {
  const curious = (curious: number): Partial<RoutineCtx> => ({ curious, random: () => 0 })

  it('a curious puppy wanders into the puddle, stamps about in it and comes out', () => {
    const p = pup(0.12, -0.12)
    let deepest = 0,
      out = Infinity,
      left = false
    run(
      [p],
      MUD_EVERY + 40,
      at(12),
      SPOTS,
      () => {
        const depth = inMud(SPOTS, p.m.pos.x, p.m.pos.z)
        if (p.r.routine === 'splashing') deepest = Math.max(deepest, depth)
        if (p.seen.includes('splashing') && p.r.routine === 'none') {
          left = true
          out = depth
        }
      },
      undefined,
      curious(0.9),
    )
    expect(p.seen).toEqual(['none', 'toMud', 'splashing', 'none'])
    expect(p.time.splashing).toBeCloseTo(SPLASH_TIME, 1)
    expect(deepest).toBeGreaterThan(0.8)
    expect(left).toBe(true)
    expect(out).toBe(0)
    expect(p.m.pose).toBe('stand')
  })

  it('goes at most once every 2 min, never without curiosity, never while playing', () => {
    expect(MUD_EVERY).toBe(120)
    const once = pup(0.12, -0.12)
    run([once], MUD_EVERY * 1.9, at(12), SPOTS, undefined, undefined, curious(1))
    expect(once.seen.filter((r) => r === 'toMud')).toHaveLength(1)
    const dull = pup(0.12, -0.12)
    run([dull], MUD_EVERY * 2, at(12), SPOTS, undefined, undefined, curious(0))
    expect(dull.seen).toEqual(['none'])
    const playing = pup(0.12, -0.12)
    run([playing], MUD_EVERY * 1.5, at(12), SPOTS, undefined, undefined, {
      ...curious(1),
      busy: true,
    })
    expect(playing.seen).toEqual(['none'])
  })

  it('play stops the stamping without a stray turn', () => {
    const p = pup(0.12, -0.12)
    p.r.mudAgo = MUD_EVERY
    for (let n = 0; n < 60 / DT && p.r.routine !== 'splashing'; n++)
      run([p], DT, at(12), SPOTS, undefined, undefined, curious(1))
    expect(p.r.routine).toBe('splashing')
    run([p], 1, at(12), SPOTS, undefined, undefined, curious(1))
    expect(p.m.face).not.toBeNull()
    run([p], DT, at(12), SPOTS, undefined, undefined, { ...curious(1), busy: true })
    expect([p.r.routine, p.m.face]).toEqual(['none', null])
  })

  it('food and bed come first', () => {
    const hungry = pup(0.12, -0.12, 0.8, 0.8, 1)
    hungry.r.mudAgo = MUD_EVERY
    run([hungry], 1, at(12), SPOTS, undefined, undefined, curious(1))
    expect(hungry.r.routine).toBe('toBowl')
    const night = pup(0.12, -0.12)
    night.r.mudAgo = MUD_EVERY
    run([night], 1, at(22), SPOTS, undefined, undefined, curious(1))
    expect(night.r.routine).toBe('toBed')
  })
})

describe('pee and poop', () => {
  /** Draws in turn: first whether it goes to the garden, then pee or poop. */
  const draws = (...values: number[]) => {
    let i = 0
    return () => values[i++ % values.length]!
  }
  const full = (p: Pup) => {
    p.care = { ...p.care, bladder: 1 }
    return p
  }
  const ahead = (m: MotionState) => ({ x: Math.sin(m.heading), z: Math.cos(m.heading) })

  it('with a full bladder it squats where it is, leaves a puddle behind it and empties', () => {
    const p = full(pup(0.12, -0.12))
    let squat = 0
    run(
      [p],
      1,
      at(12),
      SPOTS,
      () => {
        if (p.r.routine === 'relieving') squat = Math.max(squat, p.m.sitGoal)
      },
      undefined,
      { random: draws(0.9, 0.9) },
    )
    expect(p.seen).toEqual(['relieving'])
    expect(p.care.bladder).toBe(0)
    expect(p.left).toHaveLength(1)
    const [mess] = p.left
    expect(mess!.kind).toBe('pee')
    // Behind its hind paws, where it stands
    const f = ahead(p.m),
      dx = mess!.x - p.m.pos.x,
      dz = mess!.z - p.m.pos.z
    expect(dx * f.x + dz * f.z).toBeLessThan(-0.25)
    expect(Math.hypot(dx, dz)).toBeLessThan(0.35)
    expect(squat).toBeGreaterThan(0.3)
    run([p], RELIEF_TIME, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.9) })
    expect(p.seen).toEqual(['relieving', 'none'])
    expect(p.time.relieving).toBeCloseTo(RELIEF_TIME, 1)
    expect(p.left).toHaveLength(1)
  })

  it('poops a third of the time, more often just after a meal', () => {
    const p = full(pup(0.12, -0.12))
    run([p], 0.1, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.3) })
    expect(p.left[0]!.kind).toBe('poop')
    const fed = pup(0.12, -0.12, 0.8, 0.8, 1)
    run([fed], 25, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.5) })
    expect(fed.fed).toBe(1)
    full(fed)
    run([fed], 0.1, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.5) })
    expect(fed.left.at(-1)!.kind).toBe('poop')
    const later = full(pup(0.12, -0.12))
    run([later], 0.1, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.5) })
    expect(later.left[0]!.kind).toBe('pee')
  })

  it('sometimes walks to the garden first, clear of the mud, and leaves nothing there', () => {
    const p = full(pup(0.12, -0.12))
    run([p], 30, at(12), SPOTS, undefined, undefined, { random: draws(0.1, 0.9) })
    expect(p.seen.slice(0, 3)).toEqual(['toGarden', 'relieving', 'none'])
    expect(p.left).toEqual([])
    expect(p.care.bladder).toBeLessThan(0.01)
    const { center, radius, depth } = SPOTS.garden
    expect(Math.hypot(p.m.pos.x - center.x, p.m.pos.z - center.z)).toBeLessThan(
      Math.max(radius, depth),
    )
    expect(inMud(SPOTS, p.m.pos.x, p.m.pos.z)).toBe(0)
  })

  it('with two messes waiting it always goes to the garden', () => {
    const p = full(pup(0.12, -0.12))
    const mess = { kind: 'pee' as const, x: 0, z: 0, createdAt: 0 }
    p.care = addMess(addMess(p.care, mess), { ...mess })
    run([p], 1, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.9) })
    expect(p.r.routine).toBe('toGarden')
  })

  it('fills while awake, holds on asleep and goes once it wakes', () => {
    const awake = pup(0.12, -0.12)
    run([awake], 60, at(12))
    expect(awake.care.bladder).toBeGreaterThan(0.004)
    const sleeper = pup(0, 0)
    tuckIn(sleeper.r, sleeper.m)
    run([sleeper], 60, at(23))
    expect(sleeper.care.bladder).toBe(0)
    full(sleeper)
    run([sleeper], 10, at(23), SPOTS, undefined, undefined, { random: draws(0.9, 0.9) })
    expect(sleeper.r.routine).toBe('sleeping')
    touch(sleeper.r)
    run([sleeper], 3, at(23), SPOTS, undefined, undefined, { random: draws(0.9, 0.9) })
    expect(sleeper.seen.slice(-3)).toEqual(['stretch', 'none', 'relieving'])
  })

  it('waits while it eats or plays', () => {
    const eating = pup(0.12, -0.12, 0.8, 0.8, 1)
    run([eating], 6, at(12))
    expect(eating.r.routine).toBe('eating')
    full(eating)
    run([eating], 6, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.9) })
    expect(eating.seen.slice(eating.seen.indexOf('eating'))).toEqual([
      'eating',
      'none',
      'relieving',
      'none',
    ])
    expect(eating.time.eating).toBeCloseTo(MEAL_TIME, 1)
    const playing = full(pup(0.12, -0.12))
    run([playing], 2, at(12), SPOTS, undefined, undefined, { busy: true })
    expect(playing.seen).toEqual(['none'])
  })

  it('a call cuts the squat short; the puddle is already there', () => {
    const p = full(pup(0.12, -0.12))
    run([p], 0.5, at(12), SPOTS, undefined, undefined, { random: draws(0.9, 0.9) })
    p.m.goal = p.m.pos.clone().set(0.5, 0, 0.3)
    run([p], DT, at(12))
    expect(p.r.routine).toBe('none')
    expect(p.left).toHaveLength(1)
  })

  it('relieveNow squats at once with the kind asked for', () => {
    const p = pup(0.12, -0.12)
    relieveNow(p.r, p.m, 'poop')
    run([p], 0.1, at(12))
    expect(p.left.map((m) => m.kind)).toEqual(['poop'])
  })

  it('while a mess waits, it gets a little sadder, 0.1 at most', () => {
    const p = pup(0.12, -0.12)
    p.care = addMess({ ...p.care, happiness: 0.8 }, { kind: 'pee', x: 0, z: 0, createdAt: 0 })
    run([p], 60, at(12))
    expect(p.care.happiness).toBeLessThan(0.8)
    run([p], 1200, at(12))
    expect(p.care.happiness).toBeCloseTo(0.8 - MESS_GLOOM_MAX)
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
