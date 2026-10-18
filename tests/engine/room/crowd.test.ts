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
import { anatomy } from '@/engine/puppy/anatomy'
import { BALL_R, createBall, stepBall, type BallState } from '@/engine/room/ball'
import { clampPlay, createCamera, fitCamera, playLocal, PLAY } from '@/engine/room/camera'
import { claimBall, separate } from '@/engine/room/crowd'

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

describe('separate', () => {
  it('keeps two puppies sent to the same spot at least 0.45 apart', () => {
    const a = puppy(-0.6, 0),
      b = puppy(0.6, 0.1)
    const opts = {
      happy: 0.5,
      energy: 0.5,
      clamp: (x: number, z: number): [number, number] => [x, z],
    }
    goTo(a.m, 0, 0.4, opts)
    goTo(b.m, 0, 0.4, opts)
    let closest = Infinity
    for (let n = 0; n < 60 * 6; n++) {
      for (const p of [a, b]) {
        stepPoses(p.m, DT)
        stepLocomotion(p.m, p.legs, DT)
      }
      separate([a.m, b.m])
      closest = Math.min(closest, flat(a.m, b.m))
    }
    expect(a.m.goal).toBeNull()
    expect(b.m.goal).toBeNull()
    expect(closest).toBeGreaterThanOrEqual(0.45 - 1e-9)
    expect(flat(a.m, b.m)).toBeLessThan(0.6)
  })

  it('leaves a sleeper in its place and puts the whole push on the awake one', () => {
    const sleeper = createMotionState(),
      awake = createMotionState()
    setPose(sleeper, 'sleep')
    awake.pos.set(0.2, 0, 0)
    separate([awake, sleeper], 0.45)
    expect(sleeper.pos.length()).toBe(0)
    expect(awake.pos.x).toBeCloseTo(0.45)
  })

  it('pulls apart two puppies standing on the same spot', () => {
    const a = createMotionState(),
      b = createMotionState()
    separate([a, b], 0.45)
    expect(flat(a, b)).toBeCloseTo(0.45)
  })
})

describe('separate at the edge of the play area', () => {
  const cam = fitCamera(createCamera(), 0.46)
  const clamp = (x: number, z: number) => clampPlay(cam, x, z)
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
    'a walker nudges a puppy on the %s edge along it, never out of the frame',
    (_, [ex, ez], [wx, wz]) => {
      const idle = puppy(ex, ez),
        walker = puppy(wx, wz)
      const goal = idle.m.pos.clone()
      goTo(walker.m, goal.x, goal.z, { happy: 0.5, energy: 0.5, clamp })
      let nearest = Infinity
      for (let n = 0; n < 60 * 10; n++) {
        for (const p of [idle, walker]) {
          stepPoses(p.m, DT)
          stepLocomotion(p.m, p.legs, DT)
        }
        separate([idle.m, walker.m], 0.45, clamp)
        for (const p of [idle, walker]) {
          const [cx, cz] = clamp(p.m.pos.x, p.m.pos.z)
          expect(Math.hypot(cx - p.m.pos.x, cz - p.m.pos.z)).toBeLessThan(1e-6)
        }
        expect(flat(idle.m, walker.m)).toBeGreaterThanOrEqual(0.45 - 1e-6)
        nearest = Math.min(nearest, Math.hypot(walker.m.pos.x - goal.x, walker.m.pos.z - goal.z))
      }
      expect(nearest).toBeLessThan(0.1)
    },
  )
})

describe('claimBall', () => {
  it('sends the puppy whose mouth is nearest; the other watches it go', () => {
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(0, BALL_R, 1)
    // Same body distance from the ball, but one faces it and the other faces away
    const away = puppy(0, 0.45, Math.PI),
      facing = puppy(0, 1.55, Math.PI)
    for (const p of [away, facing]) p.f.task = 'chase'
    const winner = claimBall([away.f, facing.f], [away.m, facing.m], ball, [
      away.mouth(new THREE.Vector3()),
      facing.mouth(new THREE.Vector3()),
    ])
    expect(winner).toBe(1)
    expect(facing.f.task).toBe('chase')
    expect(away.f.task).toBe('free')
    expect(away.f.watch).toBe(true)
  })

  it('claims nothing when the ball is not loose', () => {
    const p = puppy(0, 0)
    p.f.task = 'chase'
    expect(claimBall([p.f], [p.m], createBall())).toBeNull()
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
        dogs.map((p) => p.mouth(new THREE.Vector3())),
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
      separate(dogs.map((p) => p.m))
      stepBall(ball, cam, DT)
    }

    expect(tasks[0]).toEqual(['chase', 'grab', 'return', 'present', 'free'])
    expect(tasks[1]).toEqual(['free'])
    expect([grabbed, dropped]).toEqual([1, 1])
    expect(farHeld).toBe(false)
    expect(far.f.watch).toBe(false)
  })
})
