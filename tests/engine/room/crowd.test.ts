// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import type { Vec3 } from '@/engine/math'
import { createFetchState, stepFetch, type FetchState, type FetchTask } from '@/engine/motion/fetch'
import { legRigs } from '@/engine/motion/ik'
import {
  createLegStates,
  createMotionState,
  goTo,
  stepLocomotion,
  type MotionState,
} from '@/engine/motion/locomotion'
import { setPose, stepPoses } from '@/engine/motion/poses'
import { stepAside } from '@/engine/motion/routine'
import { anatomy } from '@/engine/puppy/anatomy'
import {
  BALL_R,
  bounceOff,
  createBall,
  rollOut,
  stepBall,
  throwVelocity,
  type BallState,
} from '@/engine/room/ball'
import { bodyOf, bodyShape, createBody, sphereAt, SPHERES, type Body } from '@/engine/room/bodies'
import {
  clampPlay,
  clampPlayTo,
  createCamera,
  fitCamera,
  playLocal,
  playWorld,
  PLAY,
} from '@/engine/room/camera'
import { APART_STEP, type ClampTo } from '@/engine/room/apart'
import { claimBall, inTheWay, separate } from '@/engine/room/crowd'
import { seeded } from '../seeded'

const DT = 1 / 60
const A = anatomy(BREEDS.beagle)
const REACH = A.tongue[2] - 0.12

function puppy(x: number, z: number, heading = 0) {
  const m = createMotionState()
  m.pos.set(x, 0, z)
  m.heading = heading
  const legs = createLegStates(legRigs(A), m)
  const mouth = (out: Vec3) =>
    out.set(
      m.pos.x + Math.sin(m.heading) * REACH,
      A.tongue[1],
      m.pos.z + Math.cos(m.heading) * REACH,
    )
  return { m, legs, mouth, f: createFetchState() }
}

const flat = (a: MotionState, b: MotionState) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)

/**
 * The most two bodies may overlap for the few frames `keepApart` takes to part them, a step at a
 * time, where the edge holds them and walkers keep coming.
 */
const OVERLAP = 0.03
/** …and for at most this many frames in a row. */
const OVERLAP_FRAMES = 20

/** One frame of keeping apart, as the room does: bodies placed where the puppies stand. */
function apart(ms: MotionState[], clamp?: ClampTo, fixed: readonly boolean[] | null = null) {
  separate(
    ms,
    ms.map((m) => placed(m)),
    clamp,
    fixed,
  )
}

describe('keeping off the scale', () => {
  const scale = (owner: MotionState) => ({ owner, x: 0.5, z: 0.5, r: 0.5 })

  /** A body well away from everyone, so only the scale moves them. */
  const aside = () => placed(puppy(-5, -5).m)

  it('keeps everyone but the one on the scale out of its circle, goals too', () => {
    const on = createMotionState(),
      other = createMotionState(),
      far = createMotionState()
    on.pos.set(0.5, 0, 0.5)
    other.pos.set(0.6, 0, 0.5)
    other.goal = new THREE.Vector3(0.5, 0, 0.45)
    far.pos.set(-1, 0, 0)
    separate([on, other, far], [aside(), placed(other), placed(far)], undefined, null, 0, scale(on))
    expect(on.pos.toArray()).toEqual([0.5, 0, 0.5])
    expect(other.pos.x).toBeCloseTo(0.6 + APART_STEP)
    expect(other.pos.z).toBeCloseTo(0.5)
    expect(Math.hypot(other.goal.x - 0.5, other.goal.z - 0.5)).toBeCloseTo(0.5)
    expect(far.pos.toArray()).toEqual([-1, 0, 0])
  })

  it('moves a puppy in the circle out a step a frame, never a jump', () => {
    const on = createMotionState(),
      other = createMotionState()
    on.pos.set(0.5, 0, 0.5)
    other.pos.set(0.6, 0, 0.5)
    let frames = 0
    for (; frames < 40; frames++) {
      const before = other.pos.clone()
      separate([on, other], [aside(), placed(other)], undefined, null, 0, scale(on))
      expect(other.pos.distanceTo(before)).toBeLessThanOrEqual(APART_STEP + 1e-9)
      if (other.pos.distanceTo(before) === 0) break
    }
    expect(Math.hypot(other.pos.x - 0.5, other.pos.z - 0.5)).toBeCloseTo(0.5)
    expect(frames).toBeGreaterThan(1)
  })

  it('moves one inside the circle and pressed against the weighed one at most a step in all', () => {
    // The weighed one is held in place: the other takes both the step off the scale and the push
    const on = puppy(0, 0, 0),
      other = puppy(0.2, 0.05, Math.PI / 2)
    const before = other.m.pos.clone()
    const bodies = [placed(on.m), placed(other.m)]
    expect(clearance(bodies[0]!, bodies[1]!)).toBeLessThan(0)
    separate([on.m, other.m], bodies, undefined, [true, false], DT, {
      owner: on.m,
      x: 0,
      z: 0,
      r: 0.5,
    })
    expect(on.m.pos.toArray()).toEqual([0, 0, 0])
    expect(other.m.pos.distanceTo(before)).toBeLessThanOrEqual(APART_STEP + 1e-9)
    expect(other.m.pos.distanceTo(before)).toBeGreaterThan(APART_STEP * 0.9)
  })
})

describe('separate', () => {
  it('keeps two puppies sent to the same spot apart, and their bodies out of each other', () => {
    const a = puppy(-0.6, 0),
      b = puppy(0.6, 0.1)
    const opts = {
      happy: 0.5,
      energy: 0.5,
      clamp: (x: number, z: number): [number, number] => [x, z],
      random: seeded(2),
    }
    goTo(a.m, 0, 0.4, opts)
    goTo(b.m, 0, 0.4, opts)
    expect(a.m.goal!.distanceTo(b.m.goal!)).toBeGreaterThanOrEqual(0)
    let worst = Infinity
    for (let n = 0; n < 60 * 6; n++) {
      for (const p of [a, b]) {
        stepPoses(p.m, DT)
        stepLocomotion(p.m, p.legs, DT)
      }
      apart([a.m, b.m])
      worst = Math.min(worst, clearance(placed(a.m), placed(b.m)))
    }
    expect(a.m.goal).toBeNull()
    expect(b.m.goal).toBeNull()
    expect(worst).toBeGreaterThanOrEqual(-OVERLAP)
    expect(flat(a.m, b.m)).toBeLessThan(0.8)
  })

  it('spreads the goals of two sent to the same spot', () => {
    const a = createMotionState(),
      b = createMotionState()
    a.pos.set(-2, 0, 0)
    b.pos.set(2, 0, 0)
    a.goal = new THREE.Vector3(0, 0, 0)
    b.goal = new THREE.Vector3(0.1, 0, 0)
    separate([a, b], [placed(a), placed(b)])
    expect(a.goal.distanceTo(b.goal)).toBeCloseTo(0.45)
  })
})

const SHAPE = bodyShape(A)

const placed = (m: MotionState, out: Body = createBody()) =>
  bodyOf(m.pos, m.heading, m.pose, SHAPE, out)

/** How far the nearest spheres of two bodies are from touching: negative while overlapping. */
function clearance(a: Body, b: Body) {
  let least = Infinity
  for (let i = 0; i < SPHERES; i++)
    for (let k = 0; k < SPHERES; k++) {
      const p = sphereAt(a, i),
        q = sphereAt(b, k)
      least = Math.min(least, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) - p.r - q.r)
    }
  return least
}

describe('the puppy on the scale', () => {
  it.each([0.5, 0.55, 0.6, 0.7])(
    'is never pushed off by one walking across %f in front of it',
    (ahead) => {
      const owner = puppy(0, 0, 0),
        walker = puppy(-1.2, ahead, Math.PI / 2)
      goTo(walker.m, 1.2, ahead, {
        happy: 0.5,
        energy: 0.5,
        clamp: (x, z) => [x, z],
        random: seeded(4),
      })
      let worst = Infinity
      for (let n = 0; n < 60 * 6; n++) {
        for (const p of [owner, walker]) {
          stepPoses(p.m, DT)
          stepLocomotion(p.m, p.legs, DT)
        }
        apart([owner.m, walker.m], undefined, [true, false])
        worst = Math.min(worst, clearance(placed(owner.m), placed(walker.m)))
      }
      expect(owner.m.pos.toArray()).toEqual([0, 0, 0])
      expect(worst).toBeGreaterThanOrEqual(-OVERLAP)
    },
  )
})

describe('inTheWay', () => {
  const chaser = createMotionState()
  const ball = { x: 2, z: 0 }

  it('picks the free puppy in the corridor to the ball nearest it, never the chaser', () => {
    const near = createMotionState(),
      far = createMotionState(),
      aside = createMotionState()
    near.pos.set(1.5, 0, 0.1)
    far.pos.set(0.8, 0, 0)
    aside.pos.set(1.9, 0, 1.2)
    const states = [chaser, far, near, aside]
    const bodies = states.map((m) => placed(m))
    expect(inTheWay(states, bodies, [true, true, true, true], 0, ball)).toBe(2)
    // Out of the corridor, however near the ball
    expect(inTheWay([chaser, aside], [bodies[0]!, bodies[3]!], [true, true], 0, ball)).toBe(-1)
  })

  it('never picks one that is not free to step aside', () => {
    const near = createMotionState()
    near.pos.set(1.5, 0, 0)
    const states = [chaser, near]
    expect(
      inTheWay(
        states,
        states.map((m) => placed(m)),
        [true, false],
        0,
        ball,
      ),
    ).toBe(-1)
  })
})

describe('fetch games', () => {
  const SEEDS = [1, 2, 3, 5, 7, 13, 14, 23, 31, 37]

  it.each(SEEDS)(
    'never lets two puppies chasing the ball for 10 minutes overlap or get stuck (seed %i)',
    (seed) => {
      const { worst, throws, grabbed, longest, step, gaveUp, overlapFor } = play(10, false, seed)
      expect(worst).toBeGreaterThanOrEqual(-OVERLAP)
      expect(step).toBeLessThanOrEqual(APART_STEP + 1e-9)
      expect(gaveUp).toBeLessThanOrEqual(1)
      expect(overlapFor).toBeLessThanOrEqual(OVERLAP_FRAMES)
      expect(longest).toBeLessThan(STUCK)
      expect(throws).toBeGreaterThan(40)
      expect(grabbed).toBeGreaterThan(throws * 0.8)
    },
  )

  it.each(SEEDS)(
    'never moves a sleeper the chase goes past, nor lets the chaser into it or stick (seed %i)',
    (seed) => {
      const { worst, throws, sleeperMoved, longest, step, gaveUp, overlapFor } = play(
        10,
        true,
        seed,
      )
      expect(worst).toBeGreaterThanOrEqual(-OVERLAP)
      expect(step).toBeLessThanOrEqual(APART_STEP + 1e-9)
      expect(gaveUp).toBeLessThanOrEqual(1)
      expect(overlapFor).toBeLessThanOrEqual(OVERLAP_FRAMES)
      expect(sleeperMoved).toBe(0)
      expect(longest).toBeLessThan(STUCK)
      expect(throws).toBeGreaterThan(40)
    },
  )
})

/** Longer than this without a throw, or with a chaser busy, the game is stuck. */
const STUCK = 30

/**
 * Seeded fetch games for `minutes` in a portrait room: two puppies chase every throw and one
 * brings it back, or with `sleeper` one chases while the other sleeps at the far edge. The next
 * throw comes once the chasers are free and the ball lies still, and the room does what
 * tickPuppies does: bounces and rolls the ball out, and asks one in the way to step aside.
 * `worst` is the closest any two bodies came (negative: overlapping); `longest` the most seconds
 * between throws or with a chaser busy; `step` the most `separate` moved a puppy in a frame;
 * `gaveUp` the chases given up; `overlapFor` the most frames in a row any two bodies overlapped.
 */
function play(minutes: number, sleeper: boolean, seed: number) {
  const cam = fitCamera(createCamera(), 0.46)
  const clamp = (x: number, z: number) => clampPlay(cam, x, z)
  const clampTo: ClampTo = (p) => clampPlayTo(cam, p)
  const random = seeded(seed)
  const chasers = [puppy(...playWorld(cam, 0.3, -0.3))]
  if (!sleeper) chasers.push(puppy(...playWorld(cam, 0.3, 0.3)))
  const dogs = sleeper ? [...chasers, puppy(...playWorld(cam, PLAY.far, 0))] : chasers
  const bed = dogs[1]?.m.pos.clone()
  if (sleeper) setPose(dogs[1]!.m, 'sleep')
  const motions = dogs.map((p) => p.m),
    bodies = dogs.map((p) => placed(p.m))
  const ball = createBall()
  let worst = Infinity,
    grabbed = 0,
    throws = 0,
    sleeperMoved = 0,
    sinceThrow = 0,
    longest = 0,
    step = 0,
    gaveUp = 0,
    overlapRun = 0,
    overlapFor = 0
  const busy = chasers.map(() => 0)
  const ctxs = chasers.map((p) => ({
    reach: REACH,
    cam,
    mouthWorld: p.mouth,
    mood: { happy: 0.5 },
    energy: 0.5,
    random,
  }))
  const before = dogs.map(() => new THREE.Vector3())
  for (let n = 0; n < 60 * 60 * minutes; n++) {
    const still = ball.state === 'none' || (ball.state === 'air' && ball.vel.length() < 0.05)
    if (still && chasers.every((p) => p.f.task === 'free')) {
      const [hx, hz] = playWorld(cam, PLAY.near + 0.1, 0)
      ball.pos.set(hx, 0.3, hz)
      ball.vel.copy(throwVelocity(cam, { vx: (random() - 0.5) * 900, vy: 400 + random() * 1600 })!)
      ball.state = 'air'
      for (const p of chasers) {
        p.f.task = 'chase'
        p.f.taskT = 0
      }
      claimBall(
        chasers.map((p) => p.f),
        chasers.map((p) => p.m),
        ball,
        { random, energies: [0.5, 0.8], mouths: chasers.map((p) => p.mouth(new THREE.Vector3())) },
      )
      throws++
      sinceThrow = 0
    }
    let catcher = -1
    const blocked: number[] = []
    chasers.forEach((p, i) => {
      const ctx = ctxs[i]!
      const ev = stepFetch(p.f, p.m, ball, ctx, DT)
      if (ev.grabbed) grabbed++
      if (ev.blocked) blocked.push(i)
      if (ev.gaveUp) gaveUp++
      if (p.f.holding || p.f.task === 'grab' || p.f.task === 'present') catcher = i
    })
    for (const p of dogs) {
      stepPoses(p.m, DT)
      stepLocomotion(p.m, p.legs, DT)
    }
    dogs.forEach((p, i) => placed(p.m, bodies[i]))
    dogs.forEach((p, i) => before[i]!.copy(p.m.pos))
    separate(motions, bodies, clampTo, null, DT)
    dogs.forEach((p, i) => (step = Math.max(step, p.m.pos.distanceTo(before[i]!))))
    stepBall(ball, cam, DT)
    bounceOff(ball, bodies, catcher)
    rollOut(ball, bodies, catcher, cam, DT)
    for (const i of blocked) {
      const free = motions.map((m) => m.pose === 'stand')
      const k = inTheWay(motions, bodies, free, i, ball.pos)
      if (k >= 0) stepAside(motions[k]!, ball.pos.x, ball.pos.z, clamp)
    }
    sinceThrow += DT
    longest = Math.max(longest, sinceThrow)
    for (let i = 0; i < chasers.length; i++) {
      busy[i] = chasers[i]!.f.task === 'free' ? 0 : busy[i]! + DT
      longest = Math.max(longest, busy[i]!)
    }
    let least = Infinity
    for (let i = 0; i < dogs.length; i++)
      for (let j = i + 1; j < dogs.length; j++)
        least = Math.min(least, clearance(bodies[i]!, bodies[j]!))
    worst = Math.min(worst, least)
    overlapRun = least < -1e-6 ? overlapRun + 1 : 0
    overlapFor = Math.max(overlapFor, overlapRun)
    if (sleeper && bed) sleeperMoved = Math.max(sleeperMoved, dogs[1]!.m.pos.distanceTo(bed))
  }
  return { worst, throws, grabbed, sleeperMoved, longest, step, gaveUp, overlapFor }
}

describe('separate at the edge of the play area', () => {
  const cam = fitCamera(createCamera(), 0.46)
  const clamp = (x: number, z: number) => clampPlay(cam, x, z)
  const clampTo: ClampTo = (p) => clampPlayTo(cam, p)
  const at = (d: number, side: number) => {
    const q = playLocal(cam, 0, 0)
    return clamp(cam.target.x + q.fx * d - q.fz * side, cam.target.z + q.fz * d + q.fx * side)
  }
  const edges: [string, [number, number], [number, number]][] = [
    ['side', at(0.4, 9), at(0.4, 0)],
    ['far', at(PLAY.far, 0), at(PLAY.far - 1, 0)],
    ['near', at(PLAY.near, 0), at(PLAY.near + 1, 0)],
  ]

  it.each(edges)(
    'a walker heading where a puppy stands on the %s edge nudges it along, never out of the frame',
    (_, [ex, ez], [wx, wz]) => {
      const idle = puppy(ex, ez),
        walker = puppy(wx, wz)
      const goal = idle.m.pos.clone()
      goTo(walker.m, goal.x, goal.z, { happy: 0.5, energy: 0.5, clamp, random: seeded(3) })
      let worst = Infinity
      for (let n = 0; n < 60 * 10; n++) {
        for (const p of [idle, walker]) {
          stepPoses(p.m, DT)
          stepLocomotion(p.m, p.legs, DT)
        }
        const was = [idle.m.pos.clone(), walker.m.pos.clone()]
        apart([idle.m, walker.m], clampTo)
        ;[idle, walker].forEach((p, i) => {
          const [cx, cz] = clamp(p.m.pos.x, p.m.pos.z)
          expect(Math.hypot(cx - p.m.pos.x, cz - p.m.pos.z)).toBeLessThan(1e-6)
          expect(p.m.pos.distanceTo(was[i]!)).toBeLessThanOrEqual(APART_STEP + 1e-9)
        })
        worst = Math.min(worst, clearance(placed(idle.m), placed(walker.m)))
      }
      expect(worst).toBeGreaterThanOrEqual(-OVERLAP)
      // It got there, the other nudged along the edge, or it stopped short of it
      const there = Math.hypot(walker.m.pos.x - goal.x, walker.m.pos.z - goal.z) < 0.1
      expect(there || walker.m.goal === null).toBe(true)
      expect(idle.m.pos.distanceTo(goal) > 0.01 || walker.m.goal === null).toBe(true)
    },
  )
})

/** Never races (the roll is above 0.3) and picks the first chaser that outweighs a third. */
const calm = { random: () => 0.31 }

function throws(n: number, energies: number[], random: () => number) {
  const wins = [0, 0]
  for (let k = 0; k < n; k++) {
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(0, BALL_R, 1)
    const dogs = [puppy(-0.5, 0), puppy(0.5, 0)]
    for (const p of dogs) p.f.task = 'chase'
    const w = claimBall(
      dogs.map((p) => p.f),
      dogs.map((p) => p.m),
      ball,
      { random, energies },
    )
    if (w != null) wins[w]!++
  }
  return wins
}

describe('claimBall', () => {
  it('splits the chases evenly between equal puppies at equal distance', () => {
    const [a, b] = throws(200, [0.5, 0.5], seeded(7))
    expect(a! / (a! + b!)).toBeGreaterThan(0.35)
    expect(a! / (a! + b!)).toBeLessThan(0.65)
  })

  it('sends the energetic puppy more often', () => {
    const [a, b] = throws(200, [0.3, 1], seeded(11))
    expect(b!).toBeGreaterThan(a!)
  })

  it('sends both on a race roll and lets only one reach the ball', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const ball: BallState = { ...createBall(), state: 'air' }
    const { fx, fz } = playLocal(cam, 0, 0)
    ball.pos.set(cam.target.x + fx * 0.9, BALL_R, cam.target.z + fz * 0.9)
    const a = puppy(ball.pos.x - REACH, ball.pos.z),
      b = puppy(ball.pos.x + REACH, ball.pos.z)
    a.m.heading = Math.PI / 2
    b.m.heading = -Math.PI / 2
    const dogs = [a, b]
    for (const p of dogs) p.f.task = 'chase'
    const winner = claimBall(
      dogs.map((p) => p.f),
      dogs.map((p) => p.m),
      ball,
      { random: () => 0.1, energies: [0.5, 0.5] },
    )
    expect(winner).toBeNull()
    expect(dogs.map((p) => p.f.task)).toEqual(['chase', 'chase'])

    let grabbed = 0
    const grabbers = new Set<number>()
    for (let n = 0; n < 60 * 8; n++) {
      dogs.forEach((p, i) => {
        const ev = stepFetch(
          p.f,
          p.m,
          ball,
          {
            reach: REACH,
            cam,
            mouthWorld: p.mouth,
            mood: { happy: 0.5 },
            energy: 0.5,
            random: () => 0.9,
          },
          DT,
        )
        if (ev.grabbed) {
          grabbed++
          grabbers.add(i)
        }
      })
      for (const p of dogs) {
        stepPoses(p.m, DT)
        stepLocomotion(p.m, p.legs, DT)
      }
      apart(dogs.map((p) => p.m))
      stepBall(ball, cam, DT)
    }
    expect(grabbed).toBe(1)
    expect(grabbers.size).toBe(1)
    const loser = dogs[grabbers.has(0) ? 1 : 0]!
    expect(loser.f.holding).toBe(false)
    expect(loser.f.task).toBe('free')
  })

  it('lets only one grab when both are within reach in the same frame', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const ball: BallState = { ...createBall(), state: 'air' }
    const { fx, fz } = playLocal(cam, 0, 0)
    ball.pos.set(cam.target.x + fx * 0.9, BALL_R, cam.target.z + fz * 0.9)
    const a = puppy(ball.pos.x - REACH, ball.pos.z, Math.PI / 2),
      b = puppy(ball.pos.x + REACH, ball.pos.z, -Math.PI / 2)
    const dogs = [a, b]
    for (const p of dogs) p.f.task = 'chase'
    let grabbed = 0,
      emptyReturn = false
    for (let n = 0; n < 60 * 8; n++) {
      for (const p of dogs) {
        const ev = stepFetch(
          p.f,
          p.m,
          ball,
          {
            reach: REACH,
            cam,
            mouthWorld: p.mouth,
            mood: { happy: 0.5 },
            energy: 0.5,
            random: () => 0.9,
          },
          DT,
        )
        if (ev.grabbed) grabbed++
        if (p.f.task === 'return' && !p.f.holding) emptyReturn = true
      }
      for (const p of dogs) {
        stepPoses(p.m, DT)
        stepLocomotion(p.m, p.legs, DT)
      }
      stepBall(ball, cam, DT)
    }
    expect(grabbed).toBe(1)
    expect(emptyReturn).toBe(false)
  })

  it('never sends a puppy that is not chasing', () => {
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(0, BALL_R, 1)
    const dogs = [puppy(-0.5, 0), puppy(0.5, 0)]
    dogs[1]!.f.task = 'chase'
    for (const random of [() => 0.1, () => 0.9, () => 0.5]) {
      dogs[1]!.f.task = 'chase'
      const w = claimBall(
        dogs.map((p) => p.f),
        dogs.map((p) => p.m),
        ball,
        { random, energies: [0.5, 0.5] },
      )
      expect(w).toBe(1)
      expect(dogs[0]!.f.task).toBe('free')
    }
  })

  it('sends the puppy whose mouth is nearest; the other watches it go', () => {
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(0, BALL_R, 1)
    // Same body distance from the ball, but one faces it and the other faces away
    const away = puppy(0, 0.45, Math.PI),
      facing = puppy(0, 1.55, Math.PI)
    for (const p of [away, facing]) p.f.task = 'chase'
    const winner = claimBall([away.f, facing.f], [away.m, facing.m], ball, {
      ...calm,
      energies: [0.5, 0.5],
      mouths: [away.mouth(new THREE.Vector3()), facing.mouth(new THREE.Vector3())],
    })
    expect(winner).toBe(1)
    expect(facing.f.task).toBe('chase')
    expect(away.f.task).toBe('free')
    expect(away.f.watch).toBe(true)
  })

  it('claims nothing when the ball is not loose', () => {
    const p = puppy(0, 0)
    p.f.task = 'chase'
    expect(claimBall([p.f], [p.m], createBall(), { ...calm, energies: [0.5] })).toBeNull()
  })

  it('lets only one of two puppies grab a thrown ball and carry it', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const ball: BallState = { ...createBall(), state: 'air' }
    const { fx, fz } = playLocal(cam, 0, 0)
    ball.pos.set(cam.target.x + fx * 0.9, BALL_R, cam.target.z + fz * 0.9)
    const near = puppy(ball.pos.x - 0.25, ball.pos.z - 0.35),
      far = puppy(ball.pos.x + 0.3, ball.pos.z - 0.6)
    const dogs = [near, far]
    for (const p of dogs) p.f.task = 'chase'
    const fetches: FetchState[] = dogs.map((p) => p.f)
    expect(
      claimBall(
        fetches,
        dogs.map((p) => p.m),
        ball,
        {
          ...calm,
          energies: [0.5, 0.5],
          mouths: dogs.map((p) => p.mouth(new THREE.Vector3())),
        },
      ),
    ).toBe(0)

    const tasks: FetchTask[][] = [[near.f.task], [far.f.task]]
    let grabbed = 0,
      dropped = 0,
      farHeld = false
    for (let n = 0; n < 60 * 20; n++) {
      dogs.forEach((p, i) => {
        const ev = stepFetch(
          p.f,
          p.m,
          ball,
          {
            reach: REACH,
            cam,
            mouthWorld: p.mouth,
            mood: { happy: 0.5 },
            energy: 0.5,
            random: () => 0.9,
          },
          DT,
        )
        if (ev.grabbed) grabbed++
        if (ev.dropped) dropped++
        if (tasks[i]!.at(-1) !== p.f.task) tasks[i]!.push(p.f.task)
      })
      farHeld ||= far.f.holding
      if (ball.state === 'mouth')
        expect(ball.pos.distanceTo(near.mouth(new THREE.Vector3()))).toBe(0)
      for (const p of dogs) {
        stepPoses(p.m, DT)
        stepLocomotion(p.m, p.legs, DT)
      }
      apart(dogs.map((p) => p.m))
      stepBall(ball, cam, DT)
    }

    expect(tasks[0]).toEqual(['chase', 'grab', 'return', 'present', 'free'])
    expect(tasks[1]).toEqual(['free'])
    expect([grabbed, dropped]).toEqual([1, 1])
    expect(farHeld).toBe(false)
    expect(far.f.watch).toBe(false)
  })
})
