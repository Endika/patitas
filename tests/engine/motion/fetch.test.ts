// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import type { Vec3 } from '@/engine/math'
import {
  createFetchState,
  stepFetch,
  type FetchCtx,
  type FetchState,
  type FetchTask,
} from '@/engine/motion/fetch'
import { legRigs } from '@/engine/motion/ik'
import { createLegStates, createMotionState, stepLocomotion } from '@/engine/motion/locomotion'
import { stepPoses } from '@/engine/motion/poses'
import { anatomy } from '@/engine/puppy/anatomy'
import { BALL_R, createBall, stepBall, type BallState } from '@/engine/room/ball'
import { clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import { computeSpots, inMud } from '@/engine/room/furniture'

const A = anatomy(BREEDS.dorado)
const DT = 1 / 60

describe('stepFetch', () => {
  it('chases, grabs, brings back and drops the ball in front of the camera', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const m = createMotionState()
    const legs = createLegStates(legRigs(A), m)
    const reach = A.tongue[2] - 0.12
    const mouthWorld = (out: Vec3) =>
      out.set(
        m.pos.x + Math.sin(m.heading) * reach,
        A.tongue[1],
        m.pos.z + Math.cos(m.heading) * reach,
      )
    const ctx: FetchCtx = {
      reach,
      cam,
      mouthWorld,
      mood: { happy: 0.5 },
      energy: 0.5,
      random: () => 0.9,
    }
    const ball: BallState = { ...createBall(), state: 'air' }
    const { fx, fz } = playLocal(cam, 0, 0)
    ball.pos.set(cam.target.x + fx * 0.9 + fz * 0.2, BALL_R, cam.target.z + fz * 0.9 - fx * 0.2)
    const f: FetchState = { ...createFetchState(), task: 'chase' }

    const tasks: FetchTask[] = [f.task]
    let grabbed = 0,
      dropped = 0
    for (let n = 0; n < 60 * 20 && !(f.task === 'free' && dropped); n++) {
      const ev = stepFetch(f, m, ball, ctx, DT)
      if (ev.grabbed) grabbed++
      if (ev.dropped) dropped++
      if (ball.state === 'mouth') expect(ball.pos.distanceTo(mouthWorld(m.pos.clone()))).toBe(0)
      stepPoses(m, DT)
      stepLocomotion(m, legs, DT)
      stepBall(ball, cam, DT)
      if (tasks.at(-1) !== f.task) tasks.push(f.task)
    }
    for (let n = 0; n < 60 * 4; n++) stepBall(ball, cam, DT)

    expect(tasks).toEqual(['chase', 'grab', 'return', 'present', 'free'])
    expect([grabbed, dropped]).toEqual([1, 1])
    expect(ball.state).toBe('air')
    expect(ball.pos.y).toBeCloseTo(BALL_R)
    expect(playLocal(cam, ball.pos.x, ball.pos.z).d).toBeLessThan(0)
  })

  it('gives up the chase when the ball is no longer loose', () => {
    const cam = fitCamera(createCamera(), 1)
    const m = createMotionState()
    const ball = createBall()
    ball.state = 'hand'
    const f = createFetchState()
    f.task = 'chase'
    stepFetch(
      f,
      m,
      ball,
      { reach: 0.2, cam, mouthWorld: (o) => o, mood: { happy: 0.5 }, energy: 0 },
      DT,
    )
    expect(f.task).toBe('free')
  })

  it('resets the sit and bow goals every tick', () => {
    const cam = fitCamera(createCamera(), 1)
    const m = createMotionState()
    m.sitGoal = 1
    m.bowGoal = 1
    const f = createFetchState()
    stepFetch(
      f,
      m,
      createBall(),
      { reach: 0.2, cam, mouthWorld: (o) => o, mood: { happy: 0.5 }, energy: 0 },
      DT,
    )
    expect([m.sitGoal, m.bowGoal]).toEqual([0, 0])
  })
})

describe('holding the ball', () => {
  const cam = fitCamera(createCamera(), 1)
  const ctx = (mouthWorld: (o: Vec3) => Vec3): FetchCtx => ({
    reach: 0.2,
    cam,
    mouthWorld,
    mood: { happy: 0.5 },
    energy: 0,
  })

  it('only the puppy that grabbed the ball keeps it at its mouth', () => {
    const ball: BallState = { ...createBall(), state: 'air' }
    const holder: FetchState = { ...createFetchState(), task: 'grab' }
    const other = createFetchState()
    stepFetch(
      holder,
      createMotionState(),
      ball,
      ctx((o) => o.set(1, 0.3, 1)),
      0.5,
    )
    expect([ball.state, holder.holding]).toEqual(['mouth', true])

    stepFetch(
      other,
      createMotionState(),
      ball,
      ctx((o) => o.set(-1, 0.3, -1)),
      DT,
    )
    expect(other.holding).toBe(false)
    expect(ball.pos.toArray()).toEqual([1, 0.3, 1])
  })

  it('a chaser beaten to the ball gives up and watches it until it rests', () => {
    const ball: BallState = { ...createBall(), state: 'mouth' }
    const f: FetchState = { ...createFetchState(), task: 'chase' }
    const m = createMotionState()
    stepFetch(
      f,
      m,
      ball,
      ctx((o) => o),
      DT,
    )
    expect([f.task, f.watch]).toEqual(['free', true])

    ball.state = 'air'
    ball.vel.set(0.4, 0, 0)
    stepFetch(
      f,
      m,
      ball,
      ctx((o) => o),
      DT,
    )
    expect(f.watch).toBe(true)
    ball.vel.set(0, 0, 0)
    ball.pos.y = BALL_R
    stepFetch(
      f,
      m,
      ball,
      ctx((o) => o),
      DT,
    )
    expect(f.watch).toBe(false)
  })
})

describe('a ball in the mud', () => {
  it('the chaser picks it up and walks out through the puddle, then brings it', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const spots = computeSpots(cam, 1)
    const m = createMotionState()
    m.pos.set(0.12, 0, -0.12)
    const legs = createLegStates(legRigs(A), m)
    const reach = A.tongue[2] - 0.12
    const ball: BallState = { ...createBall(), state: 'air' }
    const [bx, bz] = clampPlay(cam, spots.mud.center.x, spots.mud.center.z)
    ball.pos.set(bx, BALL_R, bz)
    const f: FetchState = { ...createFetchState(), task: 'chase' }
    const ctx: FetchCtx = {
      reach,
      cam,
      mouthWorld: (out) =>
        out.set(
          m.pos.x + Math.sin(m.heading) * reach,
          A.tongue[1],
          m.pos.z + Math.cos(m.heading) * reach,
        ),
      mood: { happy: 0.5 },
      energy: 0.5,
      random: () => 0.9,
      wade: (x, z) => (inMud(spots, x, z) > 0 ? spots.mud.center : null),
    }
    const tasks: FetchTask[] = [f.task]
    let deepest = 0
    for (let n = 0; n < 60 * 20 && f.task !== 'present'; n++) {
      stepFetch(f, m, ball, ctx, DT)
      stepPoses(m, DT)
      stepLocomotion(m, legs, DT)
      if (f.holding) deepest = Math.max(deepest, inMud(spots, m.pos.x, m.pos.z))
      if (tasks.at(-1) !== f.task) tasks.push(f.task)
    }
    expect(tasks).toEqual(['chase', 'grab', 'return', 'present'])
    expect(deepest).toBeGreaterThan(0.8)
    expect(f.holding).toBe(true)
  })

  it('a ball out of the mud comes straight back', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const m = createMotionState()
    const f: FetchState = { ...createFetchState(), task: 'grab', taskT: 0.6 }
    const ball: BallState = { ...createBall(), state: 'mouth' }
    f.holding = true
    let asked = 0
    stepFetch(
      f,
      m,
      ball,
      {
        reach: 0.5,
        cam,
        mouthWorld: (out) => out,
        mood: { happy: 0.5 },
        energy: 0.5,
        wade: () => (asked++, null),
      },
      0.1,
    )
    expect([f.task, asked]).toEqual(['return', 1])
    expect(Math.hypot(m.goal!.x - f.drop.x, m.goal!.z - f.drop.z)).toBeLessThan(1e-9)
  })
})

describe('stepFetch when the chase is held up', () => {
  it('asks for the way after 3 s without getting nearer, then gives up at 8 s and sits', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const m = createMotionState()
    const legs = createLegStates(legRigs(A), m)
    const reach = A.tongue[2] - 0.12
    const ctx: FetchCtx = {
      reach,
      cam,
      mouthWorld: (out: Vec3) => out.set(m.pos.x, A.tongue[1], m.pos.z),
      mood: { happy: 0.5 },
      energy: 0.5,
      random: () => 0.9,
    }
    const ball: BallState = { ...createBall(), state: 'air' }
    const { fx, fz } = playLocal(cam, 0, 0)
    ball.pos.set(cam.target.x + fx * 1.2, BALL_R, cam.target.z + fz * 1.2)
    const at = ball.pos.clone()
    const f: FetchState = { ...createFetchState(), task: 'chase' }
    const blocked: number[] = []
    let gaveUp = Infinity
    for (let n = 0; n < 60 * 10 && gaveUp === Infinity; n++) {
      if (stepFetch(f, m, ball, ctx, DT).blocked) blocked.push(n * DT)
      if (f.task !== 'chase') gaveUp = n * DT
      stepPoses(m, DT)
      stepLocomotion(m, legs, DT)
      // Something it cannot get past holds it where it started
      m.pos.set(0, 0, 0)
    }
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toBeCloseTo(3, 1)
    expect(gaveUp).toBeCloseTo(8, 1)
    expect(f.task).toBe('free')
    expect(m.pose).toBe('sit')
    expect(m.goal).toBeNull()
    expect(m.face).not.toBeNull()
    expect(ball.state).toBe('air')
    expect(ball.pos.distanceTo(at)).toBe(0)

    // It sits for a while, then stands again
    let stood = Infinity
    for (let n = 0; n < 60 * 7 && stood === Infinity; n++) {
      stepFetch(f, m, ball, ctx, DT)
      stepPoses(m, DT)
      stepLocomotion(m, legs, DT)
      if (m.pose === 'stand') stood = n * DT
    }
    expect(stood).toBeCloseTo(5, 1)

    // The next throw watches the chase afresh: no call for the way straight off
    f.task = 'chase'
    f.taskT = 0
    expect(stepFetch(f, m, ball, ctx, DT).blocked).toBeUndefined()
    expect(f.stuckT).toBe(0)
    expect(f.nearest).toBeCloseTo(Math.hypot(ball.pos.x - m.pos.x, ball.pos.z - m.pos.z))
  })

  it('brings the ball back as near as it got when held up on the way', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const m = createMotionState()
    const legs = createLegStates(legRigs(A), m)
    const ctx: FetchCtx = {
      reach: 0.5,
      cam,
      mouthWorld: (out: Vec3) => out.set(m.pos.x, 0.5, m.pos.z),
      mood: { happy: 0.5 },
      energy: 0.5,
    }
    const ball: BallState = { ...createBall(), state: 'mouth' }
    const { fx, fz } = playLocal(cam, 0, 0)
    m.pos.set(cam.target.x + fx * 1.2, 0, cam.target.z + fz * 1.2)
    const start = m.pos.clone()
    const f: FetchState = { ...createFetchState(), task: 'grab', taskT: 0.6, holding: true }
    const tasks: FetchTask[] = []
    for (let n = 0; n < 60 * 6; n++) {
      stepFetch(f, m, ball, ctx, DT)
      if (tasks.at(-1) !== f.task) tasks.push(f.task)
      stepPoses(m, DT)
      stepLocomotion(m, legs, DT)
      m.pos.copy(start)
    }
    expect(tasks.slice(0, 3)).toEqual(['grab', 'return', 'present'])
  })

  it('keeps chasing, and asks nothing, while it gets nearer', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const m = createMotionState()
    const ctx: FetchCtx = {
      reach: 0.5,
      cam,
      mouthWorld: (out: Vec3) => out.copy(m.pos),
      mood: { happy: 0.5 },
      energy: 0.5,
    }
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(0, BALL_R, 5)
    const f: FetchState = { ...createFetchState(), task: 'chase' }
    for (let n = 0; n < 60 * 9; n++) {
      expect(stepFetch(f, m, ball, ctx, DT).blocked).toBeUndefined()
      m.pos.z += 0.4 * DT
    }
    expect(f.task).toBe('chase')
  })
})
