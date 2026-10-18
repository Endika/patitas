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
import { createCamera, fitCamera, playLocal } from '@/engine/room/camera'

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
