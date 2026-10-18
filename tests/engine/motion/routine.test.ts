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
  bedSlots,
  createRoutineState,
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
import { computeSpots, type Spots } from '@/engine/room/furniture'

const DT = 1 / 60
const A = anatomy(BREEDS.shiba)
const cam = fitCamera(createCamera(), 0.46)
const SPOTS = computeSpots(cam)
const clamp = (x: number, z: number) => clampPlay(cam, x, z)
const at = (h: number, min = 0) => new Date(2026, 9, 18, h, min).getTime()

interface Pup {
  r: RoutineState
  m: MotionState
  legs: LegState[]
  care: Care
  seen: Routine[]
}

function pup(x: number, z: number, energy = 0.8): Pup {
  const m = createMotionState()
  m.pos.set(x, 0, z)
  return {
    r: createRoutineState(),
    m,
    legs: createLegStates(legRigs(A), m),
    care: { ...createCare(BREEDS.shiba, 0), energy },
    seen: [],
  }
}

/** Runs the puppies for `secs` the way the room does: routine, poses, steps, then apart. */
function run(pups: Pup[], secs: number, now: number, spots: Spots = SPOTS, each?: () => void) {
  for (let n = 0; n < secs / DT; n++) {
    for (const p of pups) {
      const ctx: RoutineCtx = {
        now: now + n * DT * 1000,
        care: p.care,
        spots,
        others: pups.filter((o) => o !== p).map((o) => o.m),
        clamp,
      }
      p.care = stepRoutine(p.r, p.m, ctx, DT).care
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

/** Where a point lies in the bed's oval: below 1 is inside. */
const inBed = (m: MotionState) => {
  const { center, radius, depth, facing } = SPOTS.bed
  const rx = m.pos.x - center.x,
    rz = m.pos.z - center.z
  const u = (rx * Math.cos(facing) - rz * Math.sin(facing)) / radius,
    v = (rx * Math.sin(facing) + rz * Math.cos(facing)) / depth
  return Math.hypot(u, v)
}

describe('stepRoutine', () => {
  it('sends both puppies to bed at 20:00, where they turn round and fall asleep side by side', () => {
    const a = pup(-0.1, 0),
      b = pup(0.35, 0)
    let turned = 0,
      last = a.m.heading
    run([a, b], 40, at(20), SPOTS, () => {
      if (a.r.routine === 'toBed') turned += Math.abs(a.m.heading - last)
      last = a.m.heading
    })
    for (const p of [a, b]) {
      expect(p.seen).toEqual(['toBed', 'sleeping'])
      expect(p.m.pose).toBe('sleep')
      expect(inBed(p.m)).toBeLessThan(0.75)
    }
    expect(a.m.pos.distanceTo(b.m.pos)).toBeGreaterThanOrEqual(0.25)
    expect([a.m.sleepSide, b.m.sleepSide]).toEqual([-1, 1])
    expect(turned).toBeGreaterThan(Math.PI * 2 - 0.3)
  })

  it('walks round furniture in the way, but not round the bed it is going to', () => {
    const p = pup(-0.2, -0.3)
    const bed = SPOTS.bed.center
    const mid = { x: (p.m.pos.x + bed.x) / 2, z: (p.m.pos.z + bed.z) / 2 }
    const spots: Spots = {
      ...SPOTS,
      bowl: { ...SPOTS.bowl, center: SPOTS.bowl.center.clone().set(mid.x, 0, mid.z) },
    }
    let nearest = Infinity
    run([p], 30, at(21), spots, () => {
      nearest = Math.min(nearest, Math.hypot(p.m.pos.x - mid.x, p.m.pos.z - mid.z))
    })
    expect(nearest).toBeGreaterThan(spots.bowl.radius)
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
        { now: at(22, 1), care: p.care, spots: SPOTS, others: [], clamp },
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
    const ctx = { now: at(23), care: p.care, spots: SPOTS, others: [], clamp }
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
      { now: at(23), care: p.care, spots: SPOTS, others: [], clamp, busy: true },
      DT,
    )
    expect([p.r.routine, p.r.idle]).toEqual(['none', 0])
  })

  it('wakes when something else stands it up', () => {
    const p = pup(0, 0)
    tuckIn(p.r, p.m)
    p.m.pose = 'stand'
    stepRoutine(p.r, p.m, { now: at(23), care: p.care, spots: SPOTS, others: [], clamp }, DT)
    expect(p.r.routine).toBe('none')
    expect(touch(p.r)).toBe(false)
  })
})

describe('bedSlots', () => {
  it('puts one puppy in the middle and two side by side, all inside the bed and the play area', () => {
    const [one] = bedSlots(SPOTS, 1)
    expect(Math.hypot(one!.x - SPOTS.bed.center.x, one!.z - SPOTS.bed.center.z)).toBeLessThan(1e-9)
    const [l, r] = bedSlots(SPOTS, 2)
    expect(Math.hypot(l!.x - r!.x, l!.z - r!.z)).toBeGreaterThanOrEqual(0.45)
    expect(playLocal(cam, l!.x, l!.z).side).toBeLessThan(playLocal(cam, r!.x, r!.z).side)
    // Each curls its head outwards, so neither hides the other
    expect([one!.side, l!.side, r!.side]).toEqual([1, -1, 1])
    for (const s of [l!, r!]) {
      const [x, z] = clamp(s.x, s.z)
      expect(Math.hypot(x - s.x, z - s.z)).toBeLessThan(1e-9)
      const m = createMotionState()
      m.pos.set(s.x, 0, s.z)
      expect(inBed(m)).toBeLessThan(0.75)
    }
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
