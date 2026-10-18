import * as THREE from 'three'
import type { Breed } from '@/domain/breeds'
import {
  feed,
  fillBladder,
  isNight,
  MESS_CAP,
  messKind,
  relieve,
  rest,
  sulk,
  tire,
  type Care,
  type MessKind,
} from '@/domain/care'
import type { Vec3 } from '@/engine/math'
import { furnitureObstacles, type Circle, type Spot, type Spots } from '@/engine/room/furniture'
import { goTo, type MotionState } from './locomotion'
import { POSES, setPose } from './poses'

/** What the puppy is doing on its own: going somewhere and doing something there. */
export type Routine =
  | 'none'
  | 'toBed'
  | 'sleeping'
  | 'stretch'
  | 'toBowl'
  | 'eating'
  | 'begging'
  | 'toScale'
  | 'onScale'
  | 'toMud'
  | 'splashing'
  | 'toGarden'
  | 'relieving'

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
  /** On the way to the bowl to ask for food rather than to eat. */
  beg: boolean
  /** Seconds since it last asked for food. */
  begAgo: number
  /** Share of a full bowl eaten in this meal and not yet fed: it counts once the meal ends. */
  eaten: number
  /** Seconds since it last came out of the mud, or since the room opened. */
  mudAgo: number
  /** Where it set off for the mud from, to go back to afterwards. */
  from: Vec3
  /** What it is about to do when it squats, and whether that is in the garden, where it leaves nothing. */
  kind: MessKind
  inGarden: boolean
  /** Squatting has begun: the bladder is empty and the mess is down. */
  relieved: boolean
  /** Seconds since it last ate. */
  fedAgo: number
  /** Seconds awake, and with a mess waiting, not yet counted into the care. */
  awake: number
  sulking: number
}

export interface RoutineCtx {
  /** Wall-clock milliseconds: the hour decides bedtime. */
  now: number
  care: Care
  spots: Spots
  /** Its place in the room's order, which says whose bed and bowl are its. */
  place: number
  breed: Breed
  /** How full its own bowl is, 0 to 1. */
  bowl: number
  /** How far in front of its body its mouth reaches the bowl, head down. */
  muzzle: number
  clamp: (x: number, z: number) => [number, number]
  /** Playing ball: routines give way and the idle count starts again. */
  busy?: boolean
  /** Its persona's curiosity, 0 to 1: how readily it wanders into the mud. None, never. */
  curious?: number
  random?: () => number
}

export interface RoutineEvents {
  /** The care after this step: energy recovers asleep and drains on the move. */
  care: Care
  yawn?: true
  /** Up from the bed and ready to play. */
  woke?: true
  /** How full its bowl is after this step. */
  bowl: number
  /** Just finished a meal. */
  fed?: true
  /** Just squatted outside the garden: what it left, and where, in world coordinates. */
  mess?: { kind: MessKind; x: number; z: number }
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
/** Seconds a full bowl lasts. */
export const MEAL_TIME = 4
/** It goes to a filled bowl from this hunger, and asks at an empty one from BEG_HUNGER. */
const MEAL_HUNGER = 0.3
const BEG_HUNGER = 0.7
/** Seconds it sits asking by an empty bowl, and at least this long before it asks again. */
const BEG_TIME = 4
export const BEG_EVERY = 30
/** Above this hunger a meal goes on whatever else is on offer: the ball, a trick, a call. */
const KEEP_EATING = 0.6
/** Leaning in over the bowl to eat. */
const EAT_BOW = 0.6
const FACED = 0.08
/** At most one wander into the mud this often, and only after this long without a touch. */
export const MUD_EVERY = 120
const MUD_IDLE = 20
/** Chance per second of setting off once it may, for a puppy fully curious. */
const MUD_RATE = 1 / 30
/** Seconds it stamps about in the puddle: turning foot to foot and sniffing at the mud. */
export const SPLASH_TIME = 5
const STAMP = 0.7,
  STAMP_TURN = 0.4,
  SNIFF_BOW = 0.45
/** Seconds it squats. */
export const RELIEF_TIME = 3
/** How often it walks to the garden first, when it may squat anywhere. */
const GARDEN_CHANCE = 0.3
/** A meal this recent makes a poop likelier. */
const FED_RECENTLY = 30 * 60
/** Behind its hind paws, so it does not stand in what it leaves. */
const MESS_BEHIND = 0.33
/** How far it walks on once done, and how far it turns off its heading for that. */
const STEP_AWAY = 0.45,
  STEP_TURN = 0.9
/** Squatting: hind end down for a pee, hunched lower for a poop. */
const PEE_SIT = 0.5,
  POOP_SIT = 0.75,
  POOP_BOW = 0.3
/** How past the mud, across the garden, it goes: as a share of the way from the puddle. */
const POTTY_FROM_MUD = 1.3
/** Seconds of bladder and sulking gathered before they are written to the care. */
const CARE_FLUSH = 10

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
    beg: false,
    begAgo: BEG_EVERY,
    eaten: 0,
    mudAgo: 0,
    from: new THREE.Vector3(),
    kind: 'pee',
    inGarden: false,
    relieved: false,
    fedAgo: FED_RECENTLY,
    awake: 0,
    sulking: 0,
  }
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function enter(r: RoutineState, next: Routine) {
  r.routine = next
  r.t = 0
  r.turnLeft = null
}

/**
 * A touch or a call: the idle count starts again, a walk to the bed, the garden or the mud is
 * dropped, and a sleeping puppy wakes with a stretch. Returns true
 * when it was asleep, so the touch does nothing else.
 */
export function touch(r: RoutineState): boolean {
  r.idle = 0
  if (r.routine === 'toBed' || r.routine === 'toGarden' || r.routine === 'toMud') enter(r, 'none')
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

/** Eating and hungry enough that the ball, a trick or a call can wait. */
export const keepsEating = (r: RoutineState, care: Care): boolean =>
  r.routine === 'eating' && care.hunger > KEEP_EATING

/**
 * Where the puppy stands to eat from `bowl`: just behind it as the camera sees it, so it faces
 * the screen with its mouth over the food.
 */
export function mealSpot(bowl: Spot, muzzle: number): { x: number; z: number; heading: number } {
  const { center, facing } = bowl
  return {
    x: center.x - Math.sin(facing) * muzzle,
    z: center.z - Math.cos(facing) * muzzle,
    heading: facing,
  }
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

const hungryFor = (ctx: RoutineCtx) => ctx.bowl > 0 && ctx.care.hunger >= MEAL_HUNGER

const toBed: Step = (r, m, ctx) => {
  if (!sleepy(r, ctx) || hungryFor(ctx)) {
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

/** Turns on the spot towards `r.heading`; true once facing it. */
function faceTarget(r: RoutineState, m: MotionState): boolean {
  const left = angle(r.heading - m.heading)
  if (Math.abs(left) <= FACED) {
    m.face = null
    return true
  }
  m.face = m.heading + Math.max(-TURN_STEP, Math.min(TURN_STEP, left))
  return false
}

const toBowl: Step = (r, m, ctx) => {
  const bowl = ctx.spots.bowls[ctx.place]
  if (r.beg && hungryFor(ctx)) r.beg = false
  if (!bowl || (!r.beg && ctx.bowl <= 0)) {
    m.goal = null
    m.face = null
    return enter(r, 'none')
  }
  if (m.pose !== 'stand') setPose(m, 'stand')
  if (!approach(r, m, ctx, bowl) || !faceTarget(r, m)) return
  if (!r.beg) return enter(r, 'eating')
  // The pause counts from here too, so a beg cut short by play does not start again at once
  r.begAgo = 0
  enter(r, 'begging')
  setPose(m, 'sit', BEG_TIME)
}

const eating: Step = (r, m, _ctx, ev, dt) => {
  // Sent off by a call or a trick: what it ate counts and the rest stays in the bowl
  if (m.goal || m.pose !== 'stand') return enter(r, 'none')
  faceTarget(r, m)
  m.bowGoal = EAT_BOW
  const bite = Math.min(ev.bowl, dt / MEAL_TIME)
  ev.bowl -= bite
  r.eaten += bite
  if (ev.bowl > 1e-9) return
  ev.bowl = 0
  ev.fed = true
  enter(r, 'none')
}

const begging: Step = (r, m, ctx) => {
  if (hungryFor(ctx)) {
    setPose(m, 'stand')
    r.beg = false
    return enter(r, 'toBowl')
  }
  if (r.t < BEG_TIME && m.pose === 'sit') return
  r.begAgo = 0
  enter(r, 'none')
}

const toMud: Step = (r, m, ctx) => {
  if (hungryFor(ctx) || sleepy(r, ctx)) {
    m.goal = null
    return enter(r, 'none')
  }
  if (m.pose !== 'stand') setPose(m, 'stand')
  if (!approach(r, m, ctx, ctx.spots.mud)) return
  r.heading = m.heading
  enter(r, 'splashing')
}

const splashing: Step = (r, m, ctx) => {
  if (m.goal || m.pose !== 'stand') {
    m.face = null
    return enter(r, 'none')
  }
  if (r.t < SPLASH_TIME) {
    m.face = r.heading + STAMP_TURN * (Math.floor(r.t / STAMP) % 2 ? 1 : -1)
    m.bowGoal = Math.sin(r.t * 2.3) > 0.4 ? SNIFF_BOW : 0
    return
  }
  m.face = null
  r.mudAgo = 0
  enter(r, 'none')
  goTo(m, r.from.x, r.from.z, { happy: 0.5, energy: 0, gait: 'trot', clamp: ctx.clamp })
}

const toGarden: Step = (r, m, ctx) => {
  if (m.pose !== 'stand') setPose(m, 'stand')
  if (!approach(r, m, ctx, ctx.spots.garden)) return
  enter(r, 'relieving')
}

const relieving: Step = (r, m, ctx, ev) => {
  if (!r.relieved) {
    r.relieved = true
    m.face = null
    ev.care = relieve(ev.care)
    if (!r.inGarden) {
      const [x, z] = ctx.clamp(
        m.pos.x - Math.sin(m.heading) * MESS_BEHIND,
        m.pos.z - Math.cos(m.heading) * MESS_BEHIND,
      )
      ev.mess = { kind: r.kind, x, z }
    }
  } else if (m.goal || m.pose !== 'stand') {
    m.sitGoal = m.bowGoal = 0
    return enter(r, 'none')
  }
  if (r.t < RELIEF_TIME) {
    m.sitGoal = r.kind === 'pee' ? PEE_SIT : POOP_SIT
    m.bowGoal = r.kind === 'pee' ? 0 : POOP_BOW
    return
  }
  m.sitGoal = m.bowGoal = 0
  enter(r, 'none')
  // A few steps on, as dogs do, and to the side of the screen away from what it did, which leaves
  // it in view (spots face the camera, so their facing gives the screen's sideways)
  const away = m.heading + STEP_TURN * (Math.sin(m.heading - ctx.spots.garden.facing) > 0 ? 1 : -1)
  const [x, z] = ctx.clamp(
    m.pos.x + Math.sin(away) * STEP_AWAY,
    m.pos.z + Math.cos(away) * STEP_AWAY,
  )
  goTo(m, x, z, { happy: 0.5, energy: 0, gait: 'walk', clamp: ctx.clamp })
}

/**
 * The extension point: each routine's step. A new routine adds its states to `Routine`, a step
 * here (walking there with `approach`), and its want in `choose`, ahead of or behind the bed by
 * priority.
 */
const STEPS: { [K in Routine]?: Step } = {
  toBed,
  sleeping,
  stretch,
  toBowl,
  eating,
  begging,
  toMud,
  splashing,
  toGarden,
  relieving,
}

function goToBowl(r: RoutineState, ctx: RoutineCtx, beg: boolean): boolean {
  const bowl = ctx.spots.bowls[ctx.place]
  if (!bowl) return false
  const spot = mealSpot(bowl, ctx.muzzle)
  r.target.set(spot.x, 0, spot.z)
  r.heading = spot.heading
  r.beg = beg
  enter(r, 'toBowl')
  return true
}

/**
 * What a puppy with nothing to do does next, first match wins (asleep or stretching it is never
 * asked):
 * 0. relieve itself, with a full bladder, once standing with nowhere to go: where it is, or now
 *    and then (always with MESS_CAP messes waiting) in the garden;
 * 1. eat, with food in its bowl and hunger from MEAL_HUNGER, even at bedtime;
 * 2. bed, after NIGHT_IDLE untouched at night or tired by day;
 * 3. ask by its empty bowl, from BEG_HUNGER and at most every BEG_EVERY seconds;
 * 4. wander into the mud, by day and left alone a while, at most every MUD_EVERY seconds and
 *    by chance, more often the more curious it is.
 */
function choose(r: RoutineState, m: MotionState, ctx: RoutineCtx, dt: number) {
  if (ctx.care.bladder >= 1) {
    // A trick or a call the player asked for comes first
    if (!m.goal && m.pose === 'stand') goRelieve(r, m, ctx)
    return
  }
  if (hungryFor(ctx) && goToBowl(r, ctx, false)) return
  const slot = bedSlots(ctx.spots)[ctx.place]
  if (slot && r.idle >= NIGHT_IDLE && sleepy(r, ctx)) {
    r.tired = ctx.care.energy < TIRED_ENERGY
    r.target.set(slot.x, 0, slot.z)
    r.heading = slot.heading
    r.side = slot.side
    enter(r, 'toBed')
    return
  }
  if (ctx.bowl <= 0 && ctx.care.hunger >= BEG_HUNGER && r.begAgo >= BEG_EVERY) {
    goToBowl(r, ctx, true)
    return
  }
  const curious = ctx.curious ?? 0
  if (
    curious > 0 &&
    r.mudAgo >= MUD_EVERY &&
    r.idle >= MUD_IDLE &&
    !sleepy(r, ctx) &&
    (ctx.random ?? Math.random)() < MUD_RATE * curious * dt
  )
    goToMud(r, m, ctx.spots, ctx.clamp)
}

function goRelieve(r: RoutineState, m: MotionState, ctx: RoutineCtx) {
  const random = ctx.random ?? Math.random
  const garden = ctx.care.messes.length >= MESS_CAP || random() < GARDEN_CHANCE
  r.kind = messKind(random(), r.fedAgo < FED_RECENTLY)
  r.inGarden = garden
  r.relieved = false
  if (!garden) return enter(r, 'relieving')
  // Across the garden from the puddle
  const g = ctx.spots.garden.center,
    mud = ctx.spots.mud.center
  const [x, z] = ctx.clamp(
    g.x + (g.x - mud.x) * POTTY_FROM_MUD,
    g.z + (g.z - mud.z) * POTTY_FROM_MUD,
  )
  r.target.set(x, 0, z)
  m.goal = null
  enter(r, 'toGarden')
}

/** Squats where it stands, at once and with `kind`: the debug page's way to see one. */
export function relieveNow(r: RoutineState, m: MotionState, kind: MessKind): void {
  r.kind = kind
  r.inGarden = false
  r.relieved = false
  m.goal = null
  enter(r, 'relieving')
}

/** Sets off for the middle of the puddle, to stamp about in it and come back. */
export function goToMud(
  r: RoutineState,
  m: MotionState,
  spots: Spots,
  clamp: RoutineCtx['clamp'],
): void {
  const { center } = spots.mud
  const [x, z] = clamp(center.x, center.z)
  r.from.copy(m.pos)
  r.target.set(x, 0, z)
  enter(r, 'toMud')
}

/**
 * One step of the puppy's own routine: eats from its bowl or asks by it, goes to bed tired or at
 * night, turns round and sleeps, stretches on waking. Call it after `stepFetch` (which resets
 * `bowGoal` for it to set) and before `stepPoses` and `stepLocomotion`.
 */
export function stepRoutine(
  r: RoutineState,
  m: MotionState,
  ctx: RoutineCtx,
  dt: number,
): RoutineEvents {
  r.t += dt
  r.idle += dt
  r.begAgo += dt
  r.mudAgo += dt
  r.fedAgo += dt
  if (r.routine !== 'sleeping') r.awake += dt
  r.sulking = ctx.care.messes.length ? r.sulking + dt : 0
  const ev: RoutineEvents = {
    care:
      r.routine === 'sleeping'
        ? rest(ctx.care, dt)
        : m.speed > MOVING
          ? tire(ctx.care, dt)
          : ctx.care,
    bowl: ctx.bowl,
  }
  if (r.awake >= CARE_FLUSH) {
    ev.care = fillBladder(ev.care, r.awake)
    r.awake = 0
  }
  if (r.sulking >= CARE_FLUSH) {
    ev.care = sulk(ev.care, r.sulking)
    r.sulking = 0
  }
  if (ctx.busy && !keepsEating(r, ctx.care)) {
    r.idle = 0
    // The stamp's heading goes with it, or play would start with a stray turn
    if (r.routine === 'splashing' || r.routine === 'toMud') m.face = null
    if (r.routine === 'relieving') m.sitGoal = m.bowGoal = 0
    if (r.routine !== 'none') enter(r, 'none')
  } else {
    if (r.routine === 'none') choose(r, m, ctx, dt)
    STEPS[r.routine]?.(r, m, ctx, ev, dt)
  }
  // A meal counts once it is over, however it ended
  if (r.routine !== 'eating' && r.eaten > 0) {
    ev.care = feed(ev.care, ctx.breed, r.eaten)
    r.eaten = 0
    r.fedAgo = 0
  }
  return ev
}
