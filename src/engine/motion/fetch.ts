import * as THREE from 'three'
import type { Vec3 } from '@/engine/math'
import { BALL_R, type BallState } from '@/engine/room/ball'
import { cameraPosition, clampPlay, playAxes, type FixedCamera } from '@/engine/room/camera'
import type { GaitId } from './gaits'
import { goTo, type MotionState } from './locomotion'

export type FetchTask = 'free' | 'wait' | 'chase' | 'grab' | 'return' | 'present'

export interface FetchState {
  task: FetchTask
  taskT: number
  drop: Vec3
  /** This puppy has the ball in its mouth; only the holder carries it. */
  holding: boolean
  /** Lost the ball to another puppy: follows it with its eyes until it comes to rest. */
  watch: boolean
}

export interface FetchEvents {
  grabbed?: true
  dropped?: true
}

export interface FetchCtx {
  /** How far ahead of the body the mouth reaches the ball. */
  reach: number
  cam: FixedCamera
  /** Writes the mouth's world position into `out`; the ball follows it while held. */
  mouthWorld: (out: Vec3) => Vec3
  /** Waiting and dropping the ball raise `happy`. */
  mood: { happy: number }
  energy: number
  random?: () => number
}

export function createFetchState(): FetchState {
  return { task: 'free', taskT: 0, drop: new THREE.Vector3(), holding: false, watch: false }
}

const camPos = new THREE.Vector3()

const resting = (ball: BallState) =>
  ball.state === 'air' && ball.vel.length() < 0.05 && ball.pos.y < BALL_R + 0.01

/**
 * One tick of the fetch game. Resets `sitGoal` and `bowGoal` before setting its own, so call it
 * before `stepPoses` (which raises `sitGoal` while sitting) and `stepLocomotion` each frame.
 */
export function stepFetch(
  f: FetchState,
  m: MotionState,
  ball: BallState,
  ctx: FetchCtx,
  dt: number,
): FetchEvents {
  const ev: FetchEvents = {},
    p = ball.pos,
    { cam, mood } = ctx
  const go = (x: number, z: number, gait: GaitId) =>
    goTo(m, x, z, {
      happy: mood.happy,
      energy: ctx.energy,
      gait,
      clamp: (cx, cz) => clampPlay(cam, cx, cz),
      ...(ctx.random && { random: ctx.random }),
    })
  f.taskT += dt
  if (f.holding && ball.state !== 'mouth') f.holding = false
  if (
    f.watch &&
    (f.task !== 'free' || ball.state === 'none' || ball.state === 'hand' || resting(ball))
  )
    f.watch = false
  m.sitGoal = 0
  m.bowGoal = 0
  if (f.task === 'wait') {
    mood.happy = Math.min(1, mood.happy + dt * 0.06)
    m.bowGoal = Math.sin(f.taskT * 1.4) > 0.1 ? 1 : 0
  } else if (f.task === 'chase') {
    if (ball.state !== 'air') {
      f.task = 'free'
      f.watch = ball.state === 'mouth'
      return ev
    }
    const dx = p.x - m.pos.x,
      dz = p.z - m.pos.z,
      dist = Math.hypot(dx, dz) || 1
    go(p.x - (dx / dist) * ctx.reach, p.z - (dz / dist) * ctx.reach, dist > 0.8 ? 'hop' : 'trot')
    if (dist < ctx.reach + 0.08 && ball.vel.length() < 0.9 && p.y < BALL_R + 0.03) {
      f.task = 'grab'
      f.taskT = 0
      m.goal = null
      m.face = Math.atan2(dx, dz)
    }
  } else if (f.task === 'grab') {
    m.bowGoal = 1
    if (f.taskT > 0.4 && !f.holding && ball.state !== 'air') {
      f.task = 'free'
      f.taskT = 0
      f.watch = ball.state === 'mouth'
      return ev
    }
    if (f.taskT > 0.4 && ball.state === 'air') {
      ball.state = 'mouth'
      ball.vel.set(0, 0, 0)
      f.holding = true
      ev.grabbed = true
    }
    if (f.taskT > 0.65) {
      f.task = 'return'
      f.taskT = 0
      const toCam = playAxes(cam)
      f.drop.set(cam.target.x - toCam.fx * 0.45, 0, cam.target.z - toCam.fz * 0.45)
      go(f.drop.x, f.drop.z, 'hop')
    }
  } else if (f.task === 'return') {
    if (!m.goal) {
      f.task = 'present'
      f.taskT = 0
      cameraPosition(cam, camPos)
      m.face = Math.atan2(camPos.x - m.pos.x, camPos.z - m.pos.z)
    }
  } else if (f.task === 'present') {
    m.sitGoal = m.face == null ? 1 : 0
    if (f.taskT > 1.1 && f.holding) {
      ctx.mouthWorld(p)
      ball.state = 'air'
      f.holding = false
      cameraPosition(cam, camPos)
      ball.vel.set(camPos.x - p.x, 0, camPos.z - p.z).setLength(0.35)
      ball.vel.y = 0.4
      mood.happy = Math.min(1, mood.happy + 0.25)
      ev.dropped = true
    }
    if (f.taskT > 2.6) f.task = 'free'
  }
  if (f.holding) ctx.mouthWorld(p)
  return ev
}
