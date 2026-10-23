import * as THREE from 'three'
import type { Vec3 } from '@/engine/math'
import { BALL_R, type BallState } from '@/engine/room/ball'
import { cameraPosition, clampPlay, playAxes, type FixedCamera } from '@/engine/room/camera'
import type { GaitId } from './gaits'
import { goTo, type GoToOpts, type MotionState } from './locomotion'
import { setPose } from './poses'

export type FetchTask = 'free' | 'wait' | 'chase' | 'grab' | 'return' | 'present' | 'pursue'

export interface FetchState {
  task: FetchTask
  taskT: number
  drop: Vec3
  /** This puppy has the ball in its mouth; only the holder carries it. */
  holding: boolean
  /** Lost the ball to another puppy: follows it with its eyes until it comes to rest. */
  watch: boolean
  /** Picked the ball up in the mud: walks out through the puddle before bringing it. */
  wading: boolean
  /** Chasing: the nearest it has got to the ball, and the seconds since it last got 0.05 nearer. */
  nearest: number
  stuckT: number
}

export interface FetchEvents {
  grabbed?: true
  dropped?: true
  /** The chase has got no nearer for a while: whoever stands in the way should step aside. */
  blocked?: true
  /** The chase got no nearer for so long that it gave up. */
  gaveUp?: true
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
  /** Where to walk through the mud with a ball picked up at (x, z), or null out of the mud. */
  wade?: (x: number, z: number) => Pick<Vec3, 'x' | 'z'> | null
}

export function createFetchState(): FetchState {
  return {
    task: 'free',
    taskT: 0,
    drop: new THREE.Vector3(),
    holding: false,
    watch: false,
    wading: false,
    nearest: Infinity,
    stuckT: 0,
  }
}

const camPos = new THREE.Vector3()

/**
 * Counts the seconds `f` has got no PROGRESS nearer its target, `dist` away now (starting again
 * when `fresh`). True the moment that reaches BLOCKED.
 */
function watch(f: FetchState, dist: number, fresh: boolean, dt: number): boolean {
  if (fresh || dist < f.nearest - PROGRESS) {
    f.nearest = dist
    f.stuckT = 0
    return false
  }
  const was = f.stuckT
  f.stuckT += dt
  return was < BLOCKED && f.stuckT >= BLOCKED
}

/** A chase that gets no nearer asks for the way after BLOCKED s and gives up after GIVE_UP s. */
const PROGRESS = 0.05,
  BLOCKED = 3,
  GIVE_UP = 8

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
  const fresh = f.taskT === 0
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
    if (watch(f, dist, fresh, dt)) ev.blocked = true
    if (f.stuckT >= GIVE_UP) {
      // It cannot get there: it sits and looks to the player, who can throw again
      f.task = 'free'
      f.taskT = 0
      cameraPosition(cam, camPos)
      setPose(m, 'sit')
      m.face = Math.atan2(camPos.x - m.pos.x, camPos.z - m.pos.z)
      ev.gaveUp = true
      return ev
    }
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
      // Only a ball in another's mouth is worth watching; a lost or put-away one is not
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
      const through = f.holding ? ctx.wade?.(p.x, p.z) : null
      f.wading = !!through
      if (through) go(through.x, through.z, 'walk')
      else go(f.drop.x, f.drop.z, 'hop')
    }
  } else if (f.task === 'return') {
    // Held up on the way back, it brings the ball as near as it got
    if (
      m.goal &&
      !f.wading &&
      watch(f, Math.hypot(f.drop.x - m.pos.x, f.drop.z - m.pos.z), fresh, dt)
    )
      m.goal = null
    if (!m.goal && f.wading) {
      f.wading = false
      go(f.drop.x, f.drop.z, 'trot')
    } else if (!m.goal) {
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

/**
 * With two, one that lost the ball and is playful (energy from STEAL_KEEN), and free to (not held
 * nor asleep), goes after the one bringing it back, running up alongside its head: STEAL_SIDE to
 * one side and STEAL_LEAD ahead of it. Once their mouths are within STEAL_MOUTHS, facing the same
 * way within STEAL_ALIGN, it takes the ball, once a throw, as likely as STEAL_CHANCE times its
 * energy, and brings it back itself, the other left watching. It tries for STEAL_TIME.
 */
const STEAL_KEEN = 0.6,
  STEAL_CHANCE = 0.6,
  STEAL_TIME = 4,
  STEAL_SIDE = 0.45,
  STEAL_LEAD = 0.15,
  STEAL_MOUTHS = 0.55,
  STEAL_ALIGN = 0.9
/** How far ahead of a puppy's middle its mouth is, near enough, standing or on the move. */
const MOUTH_AHEAD = 0.41

const stealOpts: GoToOpts = {
  happy: 1,
  energy: 1,
  gait: 'hop',
  clamp: (x, z) => [x, z],
}

export function pursueBall(
  fs: FetchState[],
  ms: MotionState[],
  energies: number[],
  free: readonly boolean[],
  ball: BallState,
  cam: FixedCamera,
  random: () => number,
): void {
  const holder = fs.findIndex((f) => f.holding && f.task === 'return')
  const other = 1 - holder
  const f = fs[other],
    h = fs[holder]
  // With one puppy, the ball not on its way back or already taken once, nobody is after it
  if (holder < 0 || !f || !h || !free[other] || ball.state !== 'mouth' || ball.stolen) {
    for (const g of fs)
      if (g.task === 'pursue') {
        g.task = 'free'
        g.watch = true
      }
    return
  }
  if (f.task === 'free' && f.watch && energies[other]! >= STEAL_KEEN) {
    f.task = 'pursue'
    f.taskT = 0
  }
  if (f.task !== 'pursue') return
  const m = ms[other]!,
    hm = ms[holder]!
  if (f.taskT > STEAL_TIME || h.wading) {
    f.task = 'free'
    f.watch = true
    return
  }
  const fx = Math.sin(hm.heading),
    fz = Math.cos(hm.heading),
    sx = Math.cos(hm.heading),
    sz = -Math.sin(hm.heading)
  // Its mouth and the other's, and how far apart they face
  const mx = m.pos.x + Math.sin(m.heading) * MOUTH_AHEAD,
    mz = m.pos.z + Math.cos(m.heading) * MOUTH_AHEAD,
    hx = hm.pos.x + fx * MOUTH_AHEAD,
    hz = hm.pos.z + fz * MOUTH_AHEAD
  const turned = Math.abs(
    Math.atan2(Math.sin(m.heading - hm.heading), Math.cos(m.heading - hm.heading)),
  )
  if (Math.hypot(mx - hx, mz - hz) > STEAL_MOUTHS || turned > STEAL_ALIGN) {
    // Alongside its head, on whichever side it is already, and a little ahead
    const side = (m.pos.x - hm.pos.x) * sx + (m.pos.z - hm.pos.z) * sz >= 0 ? 1 : -1
    stealOpts.clamp = (cx, cz) => clampPlay(cam, cx, cz)
    stealOpts.random = random
    goTo(
      m,
      hm.pos.x + sx * side * STEAL_SIDE + fx * STEAL_LEAD,
      hm.pos.z + sz * side * STEAL_SIDE + fz * STEAL_LEAD,
      stealOpts,
    )
    return
  }
  ball.stolen = true
  if (random() >= STEAL_CHANCE * energies[other]!) {
    f.task = 'free'
    f.watch = true
    return
  }
  // Snatched: it brings the ball back, and the other is left to watch it go
  h.holding = false
  h.task = 'free'
  h.taskT = 0
  h.watch = true
  hm.goal = null
  f.holding = true
  f.task = 'return'
  f.taskT = 0
  const toCam = playAxes(cam)
  f.drop.set(cam.target.x - toCam.fx * 0.45, 0, cam.target.z - toCam.fz * 0.45)
  goTo(m, f.drop.x, f.drop.z, stealOpts)
}
