import * as THREE from 'three'
import { clamp, MAX_DT, type Vec3 } from '@/engine/math'
import { sphereAt, SPHERES, type Body, type Sphere } from './bodies'
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

/** How much of its speed into a puppy the ball keeps as it bounces off. */
const BODY_BOUNCE = 0.5
/** Deeper than this into a sphere counts as touching it; on its surface the ball is left alone. */
const TOUCH = 1e-9
/** Passes over the bodies a frame: a ball wedged where two spheres meet gets out of both. */
const BODY_PASSES = 3

/**
 * Bounces a loose ball off the puppies: the sphere it is deepest in pushes it out to its surface
 * (never through the floor) and turns back the speed it had into it. Skips the puppy at `skip`,
 * the one catching it or carrying it. Returns whether the ball touched anyone.
 */
export function bounceOff(ball: BallState, bodies: readonly Body[], skip: number | -1): boolean {
  if (ball.state !== 'air') return false
  const p = ball.pos,
    v = ball.vel
  let hit = false
  for (let pass = 0; pass < BODY_PASSES; pass++) {
    let deepest: Sphere | null = null,
      depth = TOUCH
    for (let i = 0; i < bodies.length; i++) {
      if (i === skip) continue
      for (let k = 0; k < SPHERES; k++) {
        const s = sphereAt(bodies[i]!, k),
          d = s.r + BALL_R - Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z)
        if (d > depth) {
          depth = d
          deepest = s
        }
      }
    }
    if (!deepest) break
    hit = true
    pushOut(p, deepest)
    const dx = p.x - deepest.x,
      dy = p.y - deepest.y,
      dz = p.z - deepest.z,
      l = Math.hypot(dx, dy, dz),
      into = (v.x * dx + v.y * dy + v.z * dz) / l
    if (into < 0) {
      const k = ((1 + BODY_BOUNCE) * into) / l
      v.x -= k * dx
      v.y -= k * dy
      v.z -= k * dz
    }
  }
  return hit
}

/** Moves the ball's centre `p` onto the surface of `s` grown by the ball, staying on the floor. */
function pushOut(p: Vec3, s: Sphere) {
  const reach = s.r + BALL_R
  let dx = p.x - s.x,
    dy = p.y - s.y,
    dz = p.z - s.z
  const l = Math.hypot(dx, dy, dz)
  if (l < 1e-9) {
    dx = 0
    dy = 1
    dz = 0
  }
  const k = reach / (l < 1e-9 ? 1 : l)
  p.set(s.x + dx * k, s.y + dy * k, s.z + dz * k)
  if (p.y >= BALL_R) return
  // Pushed down into the floor: out sideways instead, along the floor
  p.y = BALL_R
  const up = BALL_R - s.y,
    side = Math.sqrt(Math.max(0, reach * reach - up * up)),
    hx = p.x - s.x,
    hz = p.z - s.z,
    h = Math.hypot(hx, hz)
  if (h > 1e-9) p.set(s.x + (hx / h) * side, BALL_R, s.z + (hz / h) * side)
  else p.set(s.x + side, BALL_R, s.z)
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
