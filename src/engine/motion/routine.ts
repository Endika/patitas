import * as THREE from 'three'
import { isNight, rest, tire, type Care } from '@/domain/care'
import type { Vec3 } from '@/engine/math'
import { furnitureObstacles, type Circle, type Spot, type Spots } from '@/engine/room/furniture'
import { goTo, type MotionState } from './locomotion'
import { POSES, setPose } from './poses'

/** What the puppy is doing on its own: going somewhere and doing something there. */
export type Routine =
  'none' | 'toBed' | 'sleeping' | 'stretch' | 'toBowl' | 'eating' | 'toScale' | 'onScale'

export interface RoutineState {
  routine: Routine
  /** Seconds in the current routine. */
  t: number
  /** Seconds since the last touch or game. */
  idle: number
  /** Went to bed by day for want of energy: sleeps on until rested. */
  tired: boolean
  /** Where the current routine is headed, and the heading to end up at there. */
  target: Vec3
  heading: number
  /** Which way the head curls when it lies down there: −1 to the screen's left, +1 right. */
  side: number
  /** Radians still to turn round on the spot before lying down; null while walking there. */
  turnLeft: number | null
  lastHeading: number
}

export interface RoutineCtx {
  /** Wall-clock milliseconds: the hour decides bedtime. */
  now: number
  care: Care
  spots: Spots
  /** Its place in the room's order, which says whose bed and bowl are its. */
  place: number
  clamp: (x: number, z: number) => [number, number]
  /** Playing ball: routines give way and the idle count starts again. */
  busy?: boolean
}

export interface RoutineEvents {
  /** The care after this step: energy recovers asleep and drains on the move. */
  care: Care
  yawn?: true
  /** Up from the bed and ready to play. */
  woke?: true
}

/** Seconds without a touch before a puppy that was woken at night goes back to bed. */
const NIGHT_IDLE = 90
/** By day it goes to bed below this energy, and once there sleeps on until WAKE_ENERGY. */
const TIRED_ENERGY = 0.2
const WAKE_ENERGY = 0.9
const STRETCH = 1.5
const STRETCH_BOW = 0.9
const STRETCH_YAWN = 0.5
/** Two sleepers turn this far from facing the camera, each to its own side. */
const BED_TURN = 0.25
const ARRIVED = 0.06
/** Fastest a turn in place is asked for: the yaw rate it gives tops out at about 4 rad/s. */
const TURN_STEP = 0.8
const BODY_CLEARANCE = 0.12
const DETOUR = 0.3
const MOVING = 0.05

export function createRoutineState(): RoutineState {
  return {
    routine: 'none',
    t: 0,
    idle: NIGHT_IDLE,
    tired: false,
    target: new THREE.Vector3(),
    heading: 0,
    side: 1,
    turnLeft: null,
    lastHeading: 0,
  }
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function enter(r: RoutineState, next: Routine) {
  r.routine = next
  r.t = 0
  r.turnLeft = null
}

/**
 * A touch: the idle count starts again and a sleeping puppy wakes with a stretch. Returns true
 * when it was asleep, so the touch does nothing else.
 */
export function touch(r: RoutineState): boolean {
  r.idle = 0
  if (r.routine === 'toBed') enter(r, 'none')
  if (r.routine !== 'sleeping') return false
  enter(r, 'stretch')
  return true
}

export interface BedSlot {
  x: number
  z: number
  heading: number
  /** The way the head curls: outwards for two, so neither hides the other. */
  side: number
}

/** Where each puppy lies, in the middle of its own bed, left first. */
export function bedSlots(spots: Spots): BedSlot[] {
  const two = spots.beds.length > 1
  return spots.beds.map(({ center, facing }, i) => {
    const side = two ? (i === 0 ? -1 : 1) : 1
    return {
      x: center.x,
      z: center.z,
      heading: facing + (two ? side * BED_TURN : 0),
      side,
    }
  })
}

/** Already asleep where it stands, as when the room opens at night in the bed. */
export function tuckIn(r: RoutineState, m: MotionState, side = 1): void {
  r.side = side
  lieDown(r, m)
  const P = POSES.sleep
  m.fk = m.sleepW = 1
  m.poseY = P.y
  m.spread = P.spread
  m.legPose.forEach((lp, i) => lp.splice(0, 3, ...(i < 2 ? P.front : P.hind)))
}

function lieDown(r: RoutineState, m: MotionState) {
  enter(r, 'sleeping')
  setPose(m, 'sleep')
  m.sleepSide = r.side
}

/**
 * Its bed moved by (dx, dz), with the frame or as the beds were laid out again: asleep in it, the
 * puppy is carried along with `body` (its position and the points its paws stand on); on the way
 * there, it heads for the new place.
 */
export function followBed(r: RoutineState, body: readonly Vec3[], dx: number, dz: number): void {
  if (r.routine !== 'toBed' && r.routine !== 'sleeping') return
  r.target.x += dx
  r.target.z += dz
  if (r.routine !== 'sleeping') return
  for (const p of body) {
    p.x += dx
    p.z += dz
  }
}

/**
 * The beds and bowls were laid out again for a puppy coming or going: one on its way to a piece
 * stops, to choose again where its own now stands. A sleeper sleeps on, for `followBed` to carry.
 */
export function forgetRoute(r: RoutineState, m: MotionState): void {
  if (r.routine === 'none' || r.routine === 'sleeping' || r.routine === 'stretch') return
  m.goal = null
  m.face = null
  enter(r, 'none')
}

/** The next point to walk to: straight to `to`, or round the side of the first circle in the way. */
function detour(from: Vec3, to: Vec3, circles: readonly Circle[]): { x: number; z: number } {
  const dx = to.x - from.x,
    dz = to.z - from.z,
    len = Math.hypot(dx, dz)
  if (len < 1e-6) return to
  const fx = dx / len,
    fz = dz / len
  let best: { x: number; z: number } | null = null,
    bestT = Infinity
  for (const c of circles) {
    const t = (c.x - from.x) * fx + (c.z - from.z) * fz
    const lateral = (c.x - from.x) * -fz + (c.z - from.z) * fx
    if (t <= 0 || t >= len || Math.abs(lateral) >= c.r + BODY_CLEARANCE || t >= bestT) continue
    // Pass on the side the path already leans to
    const s = lateral > 0 ? 1 : -1,
      R = c.r + DETOUR
    best = { x: c.x + fz * s * R, z: c.z - fx * s * R }
    bestT = t
  }
  return best ?? to
}

/**
 * Walks to `r.target`, round any furniture in the way except `spot`, the piece it is going to.
 * Returns true once there and standing still: the routine's "do something" can start.
 */
export function approach(r: RoutineState, m: MotionState, ctx: RoutineCtx, spot: Spot): boolean {
  const dist = Math.hypot(r.target.x - m.pos.x, r.target.z - m.pos.z)
  if (dist <= ARRIVED && !m.goal) return true
  const way = detour(
    m.pos,
    r.target,
    furnitureObstacles(ctx.spots).filter((c) => c.x !== spot.center.x || c.z !== spot.center.z),
  )
  if (!m.goal || Math.hypot(m.goal.x - way.x, m.goal.z - way.z) > 0.02)
    goTo(m, way.x, way.z, { happy: 0, energy: 0, gait: 'walk', clamp: ctx.clamp })
  return false
}

type Step = (
  r: RoutineState,
  m: MotionState,
  ctx: RoutineCtx,
  ev: RoutineEvents,
  dt: number,
) => void

const sleepy = (r: RoutineState, ctx: RoutineCtx) =>
  isNight(ctx.now) || ctx.care.energy < (r.tired ? WAKE_ENERGY : TIRED_ENERGY)

const toBed: Step = (r, m, ctx) => {
  if (!sleepy(r, ctx)) {
    m.goal = null
    return enter(r, 'none')
  }
  const bed = ctx.spots.beds[ctx.place]
  if (!bed) {
    m.goal = null
    return enter(r, 'none')
  }
  if (r.turnLeft == null) {
    if (!approach(r, m, ctx, bed)) return
    // There: one full turn round, ending at the slot's heading
    r.turnLeft = Math.PI * 2 + angle(r.heading - m.heading)
    r.lastHeading = m.heading
  }
  if (m.pose !== 'stand') setPose(m, 'stand')
  r.turnLeft -= m.heading - r.lastHeading
  r.lastHeading = m.heading
  if (r.turnLeft > ARRIVED) {
    m.face = m.heading + Math.min(TURN_STEP, r.turnLeft)
    return
  }
  m.face = null
  lieDown(r, m)
}

const sleeping: Step = (r, m, ctx) => {
  if (m.pose !== 'sleep') {
    r.idle = 0
    return enter(r, 'none')
  }
  if (!sleepy(r, ctx)) enter(r, 'stretch')
}

const stretch: Step = (r, m, _ctx, ev, dt) => {
  if (m.pose !== 'stand') setPose(m, 'stand')
  m.bowGoal = r.t < STRETCH_BOW ? 1 : 0
  if (r.t >= STRETCH_YAWN && r.t - dt < STRETCH_YAWN) ev.yawn = true
  if (r.t < STRETCH) return
  r.tired = false
  enter(r, 'none')
  ev.woke = true
}

/**
 * The extension point: each routine's step. A new routine adds its states to `Routine`, a step
 * here (walking there with `approach`), and its want in `choose`, ahead of or behind the bed by
 * priority.
 */
const STEPS: { [K in Routine]?: Step } = { toBed, sleeping, stretch }

function choose(r: RoutineState, ctx: RoutineCtx) {
  const slot = bedSlots(ctx.spots)[ctx.place]
  if (slot && r.idle >= NIGHT_IDLE && sleepy(r, ctx)) {
    r.tired = ctx.care.energy < TIRED_ENERGY
    r.target.set(slot.x, 0, slot.z)
    r.heading = slot.heading
    r.side = slot.side
    enter(r, 'toBed')
  }
}

/**
 * One step of the puppy's own routine: goes to bed tired or at night, turns round and sleeps,
 * stretches on waking. Call it after `stepFetch` (it may set `bowGoal`) and before `stepPoses`
 * and `stepLocomotion`.
 */
export function stepRoutine(
  r: RoutineState,
  m: MotionState,
  ctx: RoutineCtx,
  dt: number,
): RoutineEvents {
  r.t += dt
  r.idle += dt
  const ev: RoutineEvents = {
    care:
      r.routine === 'sleeping'
        ? rest(ctx.care, dt)
        : m.speed > MOVING
          ? tire(ctx.care, dt)
          : ctx.care,
  }
  if (ctx.busy) {
    r.idle = 0
    if (r.routine !== 'none') enter(r, 'none')
    return ev
  }
  if (r.routine === 'none') choose(r, ctx)
  STEPS[r.routine]?.(r, m, ctx, ev, dt)
  return ev
}
