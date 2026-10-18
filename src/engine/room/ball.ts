import * as THREE from 'three'
import { clamp, MAX_DT, type Vec3 } from '@/engine/math'
import { PLAY, playAxes, playLocal, type FixedCamera } from './camera'

export const BALL_R = 0.075

export interface BallState {
  pos: Vec3
  vel: Vec3
  /** Rolling rotation; only x and z are used. */
  rot: Vec3
  state: 'none' | 'hand' | 'air' | 'mouth'
}

export function createBall(): BallState {
  return {
    pos: new THREE.Vector3(0, BALL_R, 0),
    vel: new THREE.Vector3(),
    rot: new THREE.Vector3(),
    state: 'none',
  }
}

/**
 * Pull on a ball lying outside the play area, up to a slow inward roll. Reflecting outward
 * velocity alone leaves a resting ball stranded when the screen turns and the area shrinks.
 */
const RETURN_ACC = 3,
  RETURN_V = 0.6

/** Gravity, bounces, floor friction and invisible walls at the frame edges. Only moves a loose ball. */
export function stepBall(ball: BallState, cam: FixedCamera, dt: number): void {
  if (ball.state !== 'air') return
  dt = Math.min(dt, MAX_DT)
  const p = ball.pos,
    v = ball.vel
  v.y -= 6.5 * dt
  // Walls are tested where the ball is about to be, so a fast ball turns before it crosses
  const q = playLocal(cam, p.x + v.x * dt, p.z + v.z * dt),
    vd = v.x * q.fx + v.z * q.fz,
    vs = v.x * -q.fz + v.z * q.fx
  if ((q.d > PLAY.far && vd > 0) || (q.d < PLAY.near && vd < 0)) {
    v.x -= 1.6 * vd * q.fx
    v.z -= 1.6 * vd * q.fz
  }
  if (Math.abs(q.side) > q.half && vs * q.side > 0) {
    v.x -= 1.6 * vs * -q.fz
    v.z -= 1.6 * vs * q.fx
  }
  const inD = q.d > PLAY.far ? -1 : q.d < PLAY.near ? 1 : 0,
    inS = Math.abs(q.side) > q.half ? -Math.sign(q.side) : 0
  if ((inD || inS) && p.y <= BALL_R + 1e-3) {
    const l = Math.hypot(inD, inS),
      nx = (inD * q.fx - inS * q.fz) / l,
      nz = (inD * q.fz + inS * q.fx) / l,
      push = clamp(RETURN_V - (v.x * nx + v.z * nz), 0, RETURN_ACC * dt)
    v.x += nx * push
    v.z += nz * push
  }
  p.addScaledVector(v, dt)
  if (p.y < BALL_R) {
    p.y = BALL_R
    if (v.y < 0) v.y = -v.y * 0.55
    if (v.y < 0.25) v.y = 0
    const f = Math.exp(-2.6 * dt)
    v.x *= f
    v.z *= f
  }
  if (p.y <= BALL_R + 1e-3) {
    ball.rot.x += (v.z / BALL_R) * dt
    ball.rot.z -= (v.x / BALL_R) * dt
  }
}

/**
 * Launch velocity for an upward swipe (screen px/s, `vy` positive upwards), or null when the
 * swipe is too slow to count as a throw.
 */
export function throwVelocity(cam: FixedCamera, swipe: { vx: number; vy: number }): Vec3 | null {
  if (swipe.vy <= 150) return null
  const { fx, fz } = playAxes(cam)
  const fwd = clamp(Math.max(swipe.vy, 650) / 650, 1, 3.4),
    lat = clamp(swipe.vx / 650, -1.6, 1.6)
  return new THREE.Vector3(fx * fwd - fz * lat, 1.4 + fwd * 0.35, fz * fwd + fx * lat)
}
