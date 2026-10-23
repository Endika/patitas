import * as THREE from 'three'
import type { Breed } from '@/domain/breeds'
import {
  exercise,
  feed,
  fillBladder,
  getHungry,
  settle,
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
import { sphereAt, SPHERES, type Body } from '@/engine/room/bodies'
import { inTheWay } from '@/engine/room/crowd'
import { inOval, walkingRound, type Circle, type Spot, type Spots } from '@/engine/room/furniture'
import { SLEEP_TURN } from '@/engine/room/layout'
import { reachOf, type ClampTo } from '@/engine/room/apart'
import { goTo, type GoToOpts, type MotionState } from './locomotion'
import { POSES, setPose } from './poses'

/** What the puppy is doing on its own: going somewhere and doing something there. */
export type Routine =
  | 'none'
  | 'toBed'
  | 'settling'
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
  | 'bathing'
  | 'brushing'

/**
 * The piece last walked round and the side taken, kept so the play area's edge is checked once
 * per piece rather than every frame.
 */
/** The group of pieces it is walking round, by its first piece, and on which side. */
interface Around {
  x: number
  z: number
  side: number
}

/** Rolling in the mud or digging at it. */
export type Wallow = 'roll' | 'dig'

/** Where the player holds it still to look after its coat. */
export type HeldRoutine = 'bathing' | 'brushing'

export interface RoutineState {
  routine: Routine
  /** Seconds in the current routine. */
  t: number
  /** Seconds since the last touch or game; NIGHT_IDLE in a new room, so it goes to bed at once. */
  idle: number
  /** The same from nothing, so a new room by day is not straight away one left alone. */
  alone: number
  /** Went to bed by day for want of energy: sleeps on until rested. */
  tired: boolean
  /** Napping by day for being left alone, in its bed or where it stood; null otherwise. */
  nap: 'bed' | 'floor' | null
  /** Where the current routine is headed, and the heading to end up at there. */
  target: Vec3
  /** The point it walks to next on the way there: the target, or a way round the furniture. */
  via: Vec3
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
  /** What it chose to do in the mud once it has stamped about: roll in it or dig at it. */
  wallow: Wallow | null
  /** What it is about to do when it squats, and whether that is in the garden, where it leaves nothing. */
  kind: MessKind
  inGarden: boolean
  /** Squatting has begun: the bladder is empty and the mess is down. */
  relieved: boolean
  /** Seconds since it last ate. */
  fedAgo: number
  /** Seconds awake, with a mess waiting, in all and on the move, not yet counted into the care. */
  awake: number
  sulking: number
  passing: number
  moving: number
  /** In the bath or being brushed: it holds still for it, and wakes from a nap into it. */
  held: HeldRoutine | null
  /** Asked to go on the scale: it goes once it has stretched, if it was asleep. */
  weigh: boolean
  around: Around
  /** On its way somewhere: the nearest it has got, and the seconds since it last got nearer. */
  nearest: number
  stuckT: number
  /** Making way for `yieldTo`: it waits up to this many seconds more before setting off again. */
  waitT: number
  yieldTo: RoutineState | null
  /** Times it asked one standing in its way to step aside and got no nearer for it. */
  asked: number
  /**
   * Times it found no room to make way and backed straight off along the other's way instead, or
   * stood still for it: the last resort, never a squeeze through each other.
   */
  backedOff: number
  /** Times it was made to wait on this way somewhere. */
  yields: number
  /**
   * One that could not get out of its way (`blockedBy`), as the circle its body reaches, walked
   * round like a piece of furniture for `blockT` more seconds.
   */
  blocker: [Circle]
  blockedBy: MotionState | null
  blockT: number
  /**
   * Standing about in the way of one penned in with it: it walks to `aside` for `asideT` more
   * seconds, setting off again whenever a push stops it.
   */
  aside: Vec3
  asideT: number
  /** At the place it was walking to, turning in there: it holds its ground like one eating. */
  there: boolean
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
  /** The same clamp in place, building nothing, for the way round worked out every frame. */
  clampTo?: ClampTo
  /** Playing ball: routines give way and the idle count starts again. */
  busy?: boolean
  /** Its persona's curiosity, 0 to 1: how readily it wanders into the mud. None, never. */
  curious?: number
  /** Its persona's energy, 0 to 1: the more, the longer it lasts left alone before a nap. */
  energy?: number
  /** Its persona's cuddliness, 0 to 1: cuddly, it naps in its bed rather than where it stands. */
  cuddly?: number
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
  /** Just stepped onto the scale. */
  weighed?: true
  /** Just squatted outside the garden: what it left, and where, in world coordinates. */
  mess?: { kind: MessKind; x: number; z: number }
}

/** Seconds without a touch before a puppy that was woken at night goes back to bed. */
const NIGHT_IDLE = 90
/**
 * Left alone by day this many seconds, scaled from 0.75 to 1.25 by its energy, it naps: in its
 * bed if cuddly from NAP_CUDDLY or tired below NAP_TIRED, else where it stands, after sitting
 * SETTLE_SIT and lying SETTLE_LIE seconds. It wakes after NAP_TIME, or at a touch or the ball.
 */
const NAP_IDLE = 120,
  NAP_CUDDLY = 0.6,
  NAP_TIRED = 0.4,
  SETTLE_SIT = 2,
  SETTLE_LIE = 3,
  NAP_TIME = 180
/** By day it goes to bed below this energy, and once there sleeps on until WAKE_ENERGY. */
const TIRED_ENERGY = 0.2
const WAKE_ENERGY = 0.9
const STRETCH = 1.5
const STRETCH_BOW = 0.9
const STRETCH_YAWN = 0.5
const ARRIVED = 0.06
/** Fastest a turn in place is asked for: the yaw rate it gives tops out at about 4 rad/s. */
const TURN_STEP = 0.8
const BODY_CLEARANCE = 0.12
const DETOUR = 0.3
/** Getting no nearer than this counts as no progress on the way somewhere. */
const PROGRESS = 0.05
/** Seconds two walkers get no nearer, touching, before one makes way, and the most it waits. */
export const STUCK = 1.5
const YIELD_WAIT = 4
/** Seconds a walker that backed off from one penned in its way waits for it to step aside. */
const BACK_WAIT = 2
/** Seconds it then walks round the one that was in its way, if that is still there. */
const BLOCK_TIME = 4
/** Seconds the one in its way keeps at getting out of it. */
const ASIDE_TIME = 3
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
/** Turning slower than this, in radians a second, it has settled. */
const SETTLED = 0.3
/** At most one wander into the mud this often, and only after this long without a touch. */
export const MUD_EVERY = 120
const MUD_IDLE = 20
/** Chance per second of setting off once it may, for a puppy fully curious. */
const MUD_RATE = 1 / 30
/** Seconds it stamps about in the puddle first: turning foot to foot and sniffing at the mud. */
export const SPLASH_TIME = 2.1
const STAMP = 0.7,
  STAMP_TURN = 0.4,
  SNIFF_BOW = 0.45
/** In the mud it faces the screen's right, this far round from facing the camera. */
const IN_MUD_TURN = 1.1
/** Then it rolls in it (POSE_TIME.roll) or, as likely, digs at it (POSE_TIME.dig), bowed down. */
const ROLL_CHANCE = 0.5,
  DIG_BOW = 0.35
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
/** Seconds it stands on the scale, turned this far from facing the camera: side on, to the left. */
export const WEIGH_TIME = 3
const ON_SCALE_TURN = -1.2
/** How far it walks on, off the scale, once weighed. */
const STEP_OFF = 0.55
/** Seconds of bladder, sulking, hunger, mood and exercise gathered before they are written to the care. */
const CARE_FLUSH = 10

export function createRoutineState(): RoutineState {
  return {
    routine: 'none',
    t: 0,
    idle: NIGHT_IDLE,
    alone: 0,
    tired: false,
    nap: null,
    target: new THREE.Vector3(),
    via: new THREE.Vector3(),
    heading: 0,
    side: 1,
    turnLeft: null,
    lastHeading: 0,
    beg: false,
    begAgo: BEG_EVERY,
    eaten: 0,
    mudAgo: 0,
    from: new THREE.Vector3(),
    wallow: null,
    kind: 'pee',
    inGarden: false,
    relieved: false,
    fedAgo: FED_RECENTLY,
    awake: 0,
    sulking: 0,
    passing: 0,
    moving: 0,
    held: null,
    weigh: false,
    around: { x: NaN, z: NaN, side: 0 },
    nearest: Infinity,
    stuckT: 0,
    waitT: 0,
    yieldTo: null,
    asked: 0,
    backedOff: 0,
    yields: 0,
    blocker: [{ x: 0, z: 0, r: 0 }],
    blockedBy: null,
    blockT: 0,
    aside: new THREE.Vector3(),
    asideT: 0,
    there: false,
  }
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** The routines a nap goes through: anything else and it is over. */
const NAPPING: ReadonlySet<Routine> = new Set(['toBed', 'settling', 'sleeping', 'stretch'])

function enter(r: RoutineState, next: Routine) {
  if (!NAPPING.has(next)) r.nap = null
  r.routine = next
  r.t = 0
  r.turnLeft = null
  r.nearest = Infinity
  r.stuckT = 0
  r.waitT = 0
  r.yieldTo = null
  r.asked = 0
  r.yields = 0
  r.blockT = 0
  r.there = false
  r.wallow = null
}

/**
 * A touch or a call: the idle count starts again, a walk to the bed, the garden, the mud or the
 * scale is dropped (and a weighing it is stretching for, or a nap it is settling into), and a
 * sleeping puppy wakes with a stretch. Returns true when it was asleep, so the touch does nothing
 * else.
 */
export function touch(r: RoutineState): boolean {
  r.idle = r.alone = 0
  r.weigh = false
  if (
    r.routine === 'settling' ||
    r.routine === 'toBed' ||
    r.routine === 'toGarden' ||
    r.routine === 'toMud' ||
    r.routine === 'toScale'
  )
    enter(r, 'none')
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
  const [a, b] = spots.beds
  // Along the view, away from the camera: one behind the other, the back one turns further
  const behind =
    !!a &&
    !!b &&
    Math.abs(
      (b.center.x - a.center.x) * Math.sin(a.facing) +
        (b.center.z - a.center.z) * Math.cos(a.facing),
    ) > 0.01
  return spots.beds.map(({ center, facing }, i) => {
    const side = b ? (i === 0 ? -1 : 1) : 1
    const turn = !b ? 0 : behind && i === 0 ? SLEEP_TURN.behind : SLEEP_TURN.beside
    return { x: center.x, z: center.z, heading: facing + side * turn, side }
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
  if ((r.routine !== 'toBed' && r.routine !== 'sleeping') || r.nap === 'floor') return
  r.target.x += dx
  r.target.z += dz
  if (r.routine !== 'sleeping') return
  for (const p of body) {
    p.x += dx
    p.z += dz
  }
}

/** How far its own piece may move in a resize before one on its way there chooses again. */
export const ROUTE_MOVED = 0.05

/**
 * The piece its routine is about: its bowl, the mud, the garden or the scale. Null otherwise: its
 * bed is carried by `followBed`, and the rest are about no piece.
 */
export function routeSpot(r: RoutineState, spots: RoutePlaces, place: number): Spot | null {
  switch (r.routine) {
    case 'toBowl':
    case 'eating':
    case 'begging':
      return spots.bowls[place] ?? null
    case 'onScale':
      return spots.scale
    case 'toMud':
      return spots.mud
    case 'toGarden':
      return spots.garden
    case 'relieving':
      return r.inGarden ? spots.garden : null
    default:
      return null
  }
}

/** The pieces as `routeSpot` reads them. */
export type RoutePlaces = Pick<Spots, 'bowls' | 'scale' | 'mud' | 'garden'>

/** The pieces where they stand now, kept apart from `spots`, which a resize moves in place. */
export function routePlaces(spots: Spots): RoutePlaces {
  const copy = (p: Spot): Spot => ({ ...p, center: p.center.clone() })
  return {
    bowls: spots.bowls.map(copy),
    scale: copy(spots.scale),
    mud: copy(spots.mud),
    garden: copy(spots.garden),
  }
}

/**
 * The room was laid out again on a resize: `forgetRoute` for one whose own piece moved more than
 * ROUTE_MOVED, or came or went, and the rest carry on.
 */
export function forgetMovedRoute(
  r: RoutineState,
  m: MotionState,
  was: RoutePlaces | null,
  now: RoutePlaces | null,
  place: number,
): void {
  const from = was && routeSpot(r, was, place),
    to = now && routeSpot(r, now, place)
  if (!from && !to) return
  if (!from || !to || from.center.distanceTo(to.center) > ROUTE_MOVED) forgetRoute(r, m)
}

/**
 * The beds and bowls were laid out again for a puppy coming or going: one on its way to a piece
 * stops, to choose again where its own now stands. A sleeper sleeps on, for `followBed` to carry,
 * one on its way to the scale keeps going: it heads wherever the scale is now, and one in the mud
 * finishes there and trots back to where it came from.
 */
export function forgetRoute(r: RoutineState, m: MotionState): void {
  if (
    r.routine === 'none' ||
    r.routine === 'sleeping' ||
    r.routine === 'settling' ||
    r.routine === 'stretch' ||
    r.routine === 'bathing' ||
    r.routine === 'brushing' ||
    r.routine === 'toScale' ||
    r.routine === 'splashing'
  )
    return
  m.goal = null
  m.face = null
  enter(r, 'none')
}

/** The point `detour` chose, and scratch points for trying a side: reused, nothing is built. */
const way = new THREE.Vector3(),
  trial = new THREE.Vector3(),
  clamped = new THREE.Vector3()

/** What `Around` keeps for walking round one in its way, rather than its place. */
const MOVING_KEY = { x: Infinity, z: Infinity }

/** How a group of pieces lies across the way: see `spanOf`. */
const span = { near: Infinity, plus: -Infinity, minus: -Infinity, plusT: 0, minusT: 0 }

/**
 * How `group` lies across the way from `from` along (fx, fz) for `len`: the nearest piece in the
 * way (`near`, Infinity for none), and how far it reaches to each side and where along the way.
 */
function spanOf(
  group: readonly Circle[],
  from: Vec3,
  to: Vec3,
  fx: number,
  fz: number,
  len: number,
): void {
  span.near = Infinity
  span.plus = span.minus = -Infinity
  span.plusT = span.minusT = 0
  for (const c of group) {
    // Pieces gathered round the place it is going to: it walks in among them
    if (Math.hypot(c.x - to.x, c.z - to.z) < c.r) continue
    const t = (c.x - from.x) * fx + (c.z - from.z) * fz,
      lateral = (c.x - from.x) * -fz + (c.z - from.z) * fx
    if (t + c.r <= 0) continue
    if (t > 0 && t < len && Math.abs(lateral) < c.r + BODY_CLEARANCE)
      span.near = Math.min(span.near, t)
    if (lateral + c.r > span.plus) {
      span.plus = lateral + c.r
      span.plusT = t
    }
    if (c.r - lateral > span.minus) {
      span.minus = c.r - lateral
      span.minusT = t
    }
  }
}

/** Writes into `out` the point just past the spanned group's `side` (+1 the way `lateral` grows). */
function pass(out: Vec3, from: Vec3, fx: number, fz: number, side: number): Vec3 {
  const off = side > 0 ? span.plus + DETOUR : -(span.minus + DETOUR),
    t = side > 0 ? span.plusT : span.minusT
  return out.set(from.x + fx * t - fz * off, 0, from.z + fz * t + fx * off)
}

/** How far the play area's edge moves `p`, as `clamp` (or `clampTo`, in place) moves it. */
function clipped(p: Vec3, ctx: Pick<RoutineCtx, 'clamp' | 'clampTo'>): number {
  if (ctx.clampTo) {
    clamped.copy(p)
    ctx.clampTo(clamped)
    return Math.hypot(clamped.x - p.x, clamped.z - p.z)
  }
  const [cx, cz] = ctx.clamp(p.x, p.z)
  return Math.hypot(cx - p.x, cz - p.z)
}

/**
 * The next point to walk to: straight to `to`, or round the first group of pieces in the way
 * (pieces with no way between them, see `walkRound`), past its whole width on the side that
 * needs the shorter step aside, and kept to while the same group is in the way, unless the edge
 * of the play area leaves no way round there. A puppy that will not move out of the way
 * (`blocker`) is walked round as a group of its own. The point is shared: use it before the next
 * call.
 */
function detour(
  from: Vec3,
  to: Vec3,
  groups: readonly (readonly Circle[])[],
  ctx: Pick<RoutineCtx, 'clamp' | 'clampTo'>,
  around: Around,
  blocker: readonly Circle[] | null,
): Vec3 {
  const dx = to.x - from.x,
    dz = to.z - from.z,
    len = Math.hypot(dx, dz)
  way.copy(to)
  if (len < 1e-6) return way
  const fx = dx / len,
    fz = dz / len
  let bestT = Infinity
  for (let g = 0; g <= groups.length; g++) {
    const group = g < groups.length ? groups[g]! : blocker
    if (!group) continue
    spanOf(group, from, to, fx, fz, len)
    if (span.near >= bestT || span.near === Infinity) continue
    // The one in its way moves: it is known by being that, not by where it stands
    const key = group === blocker ? MOVING_KEY : group[0]!
    if (around.x !== key.x || around.z !== key.z) {
      around.x = key.x
      around.z = key.z
      around.side = span.plus <= span.minus ? 1 : -1
    }
    // No way round past the edge of the play area: the other side, if there is more room there
    if (clipped(pass(trial, from, fx, fz, around.side), ctx) > BODY_CLEARANCE) {
      // Hemmed in against the edge both ways: straight on is the only way out
      if (clipped(pass(trial, from, fx, fz, -around.side), ctx) > BODY_CLEARANCE) continue
      around.side = -around.side
    }
    pass(way, from, fx, fz, around.side)
    bestT = span.near
  }
  if (bestT === Infinity) around.x = around.z = NaN
  return way
}

/**
 * Walks to `r.target`, round any furniture in the way except `spot`, the piece it is going to.
 * Returns true once there and standing still: the routine's "do something" can start.
 */
export function approach(
  r: RoutineState,
  m: MotionState,
  ctx: RoutineCtx,
  spot: Spot,
  dt = 0,
): boolean {
  // Making way: it steps aside and waits, and sets off again once the other is there
  if (r.waitT > 0) {
    r.waitT = !r.yieldTo || walking(r.yieldTo) ? r.waitT - dt : 0
    if (r.waitT > 0) return false
    r.nearest = Infinity
    r.stuckT = 0
    r.yieldTo = null
  }
  const dist = Math.hypot(r.target.x - m.pos.x, r.target.z - m.pos.z)
  if (r.there || (dist <= ARRIVED && !m.goal)) return (r.there = true)
  if (dist < r.nearest - PROGRESS) {
    r.nearest = dist
    r.stuckT = 0
    r.asked = 0
  } else r.stuckT += dt
  r.blockT = Math.max(0, r.blockT - dt)
  const way = detour(
    m.pos,
    r.target,
    walkingRound(ctx.spots, spot),
    ctx,
    r.around,
    r.blockT > 0 ? r.blocker : null,
  )
  r.via.copy(way)
  if (!m.goal || Math.hypot(m.goal.x - way.x, m.goal.z - way.z) > 0.02) {
    walk.clamp = ctx.clamp
    goTo(m, way.x, way.z, walk)
  }
  return false
}

/** How `approach` walks there, kept rather than built each time the way bends. */
const walk: GoToOpts = { happy: 0, energy: 0, gait: 'walk', clamp: (x, z) => [x, z] }

type Step = (
  r: RoutineState,
  m: MotionState,
  ctx: RoutineCtx,
  ev: RoutineEvents,
  dt: number,
) => void

const sleepy = (r: RoutineState, ctx: RoutineCtx) =>
  isNight(ctx.now) ||
  ctx.care.energy < (r.tired ? WAKE_ENERGY : TIRED_ENERGY) ||
  (r.nap !== null && !(r.routine === 'sleeping' && r.t >= NAP_TIME))

const hungryFor = (ctx: RoutineCtx) => ctx.bowl > 0 && ctx.care.hunger >= MEAL_HUNGER

const toBed: Step = (r, m, ctx, _ev, dt) => {
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
    if (!approach(r, m, ctx, bed, dt)) return
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

/** Left alone, it sits, lies down and falls asleep where it stands. */
const settling: Step = (r, m, ctx) => {
  if (hungryFor(ctx) || isNight(ctx.now)) {
    if (m.pose !== 'stand') setPose(m, 'stand')
    return enter(r, 'none')
  }
  if (r.t < SETTLE_SIT) {
    if (m.pose !== 'sit') setPose(m, 'sit', SETTLE_SIT + 1)
  } else if (r.t < SETTLE_SIT + SETTLE_LIE) {
    if (m.pose !== 'lie') setPose(m, 'lie', SETTLE_LIE + 1)
  } else lieDown(r, m)
}

const sleeping: Step = (r, m, ctx) => {
  // Night falls on a nap: in its bed it sleeps on as at night, on the floor it gets up for its bed
  if (r.nap && isNight(ctx.now)) {
    if (r.nap === 'floor') return enter(r, 'stretch')
    r.nap = null
  }
  if (m.pose !== 'sleep') {
    r.idle = r.alone = 0
    return enter(r, 'none')
  }
  if (!sleepy(r, ctx)) enter(r, 'stretch')
}

const stretch: Step = (r, m, ctx, ev, dt) => {
  if (m.pose !== 'stand') setPose(m, 'stand')
  m.bowGoal = r.t < STRETCH_BOW ? 1 : 0
  if (r.t >= STRETCH_YAWN && r.t - dt < STRETCH_YAWN) ev.yawn = true
  if (r.t < STRETCH) return
  r.tired = false
  // Up from a nap, it stays awake a while before the next; night has fallen on one napping on the
  // floor, it goes to bed
  if (r.nap) {
    r.alone = 0
    if (!isNight(ctx.now)) r.idle = 0
  }
  if (r.held) return enter(r, r.held)
  if (r.weigh) return enter(r, 'toScale')
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

const toBowl: Step = (r, m, ctx, _ev, dt) => {
  const bowl = ctx.spots.bowls[ctx.place]
  if (r.beg && hungryFor(ctx)) r.beg = false
  if (!bowl || (!r.beg && ctx.bowl <= 0)) {
    m.goal = null
    m.face = null
    return enter(r, 'none')
  }
  if (m.pose !== 'stand') setPose(m, 'stand')
  if (!approach(r, m, ctx, bowl, dt) || !faceTarget(r, m)) return
  // Come round from behind it, it eats once settled, not still swinging past the bowl
  if (!r.beg && Math.abs(m.yawRate) > SETTLED) return
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

const toMud: Step = (r, m, ctx, _ev, dt) => {
  if (hungryFor(ctx) || sleepy(r, ctx)) {
    m.goal = null
    return enter(r, 'none')
  }
  if (m.pose !== 'stand') setPose(m, 'stand')
  if (!approach(r, m, ctx, ctx.spots.mud, dt) || !faceTarget(r, m)) return
  enter(r, 'splashing')
}

/** Rolling or digging in the mud right now, as it chose to. */
export const wallowing = (r: RoutineState, m: MotionState): Wallow | null =>
  r.wallow && m.pose === r.wallow ? r.wallow : null

const splashing: Step = (r, m, ctx) => {
  const now = wallowing(r, m)
  if (m.goal || (m.pose !== 'stand' && !now)) {
    m.face = null
    return enter(r, 'none')
  }
  if (r.t < SPLASH_TIME) {
    m.face = r.heading + STAMP_TURN * (Math.floor(r.t / STAMP) % 2 ? 1 : -1)
    m.bowGoal = Math.sin(r.t * 2.3) > 0.4 ? SNIFF_BOW : 0
    return
  }
  if (!r.wallow) {
    m.face = null
    r.wallow = (ctx.random ?? Math.random)() < ROLL_CHANCE ? 'roll' : 'dig'
    setPose(m, r.wallow)
    return
  }
  if (now) {
    if (now === 'dig') m.bowGoal = DIG_BOW
    return
  }
  r.mudAgo = 0
  enter(r, 'none')
  goTo(m, r.from.x, r.from.z, { happy: 0.5, energy: 0, gait: 'trot', clamp: ctx.clamp })
}

const toGarden: Step = (r, m, ctx, _ev, dt) => {
  if (m.pose !== 'stand') setPose(m, 'stand')
  if (!approach(r, m, ctx, ctx.spots.garden, dt)) return
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

const toScale: Step = (r, m, ctx, ev, dt) => {
  const { scale } = ctx.spots
  r.target.set(scale.center.x, 0, scale.center.z)
  r.heading = scale.facing + ON_SCALE_TURN
  if (m.pose !== 'stand') setPose(m, 'stand')
  if (!approach(r, m, ctx, scale, dt) || !faceTarget(r, m)) return
  r.weigh = false
  enter(r, 'onScale')
  ev.weighed = true
}

const onScale: Step = (r, m, ctx) => {
  if (m.goal || m.pose !== 'stand') {
    m.face = null
    return enter(r, 'none')
  }
  if (r.t < WEIGH_TIME) return
  enter(r, 'none')
  const [x, z] = ctx.clamp(
    m.pos.x + Math.sin(m.heading) * STEP_OFF,
    m.pos.z + Math.cos(m.heading) * STEP_OFF,
  )
  goTo(m, x, z, { happy: 0.5, energy: 0, gait: 'walk', clamp: ctx.clamp })
}

const holding: Step = (_r, m) => {
  m.goal = null
  m.face = null
  m.sitGoal = m.bowGoal = 0
  if (m.pose !== 'stand') setPose(m, 'stand')
}

/**
 * The extension point: each routine's step. A new routine adds its states to `Routine`, a step
 * here (walking there with `approach`), and its want in `choose`, ahead of or behind the bed by
 * priority.
 */
const STEPS: { [K in Routine]?: Step } = {
  toBed,
  settling,
  sleeping,
  stretch,
  toBowl,
  eating,
  begging,
  toMud,
  splashing,
  toGarden,
  relieving,
  bathing: holding,
  brushing: holding,
  toScale,
  onScale,
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
 * 3b. a nap by day, not hungry and left alone a while (see NAP_IDLE): in its bed, or where it
 *     stands;
 * 4. wander into the mud, by day and left alone a while, at most every MUD_EVERY seconds and
 *    by chance, more often the more curious it is: it stamps about, then rolls or digs.
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
  if (
    !isNight(ctx.now) &&
    ctx.care.hunger < BEG_HUNGER &&
    r.alone >= NAP_IDLE * (0.75 + 0.5 * (ctx.energy ?? 0.5))
  ) {
    if (slot && ((ctx.cuddly ?? 0) >= NAP_CUDDLY || ctx.care.energy < NAP_TIRED)) {
      r.nap = 'bed'
      r.target.set(slot.x, 0, slot.z)
      r.heading = slot.heading
      r.side = slot.side
      enter(r, 'toBed')
    } else {
      r.nap = 'floor'
      r.side = (ctx.random ?? Math.random)() < 0.5 ? -1 : 1
      m.goal = null
      enter(r, 'settling')
    }
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
  // Its place on the grass, away from the puddle
  const [x, z] = ctx.clamp(ctx.spots.garden.center.x, ctx.spots.garden.center.z)
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

/** Whatever it was doing stops (a meal counts what it ate) and it stands where it is. */
function stopHere(r: RoutineState, m: MotionState, next: Routine) {
  m.goal = null
  m.face = null
  m.sitGoal = m.bowGoal = 0
  enter(r, next)
}

/**
 * The bath or the brush starts where the puppy stands: it stops what it was doing and stands still
 * for it. A sleeper stretches first.
 */
export function holdStill(r: RoutineState, m: MotionState, held: HeldRoutine): void {
  r.held = held
  r.weigh = false
  r.idle = r.alone = 0
  if (r.routine === 'sleeping') return enter(r, 'stretch')
  if (r.routine !== 'stretch') stopHere(r, m, held)
}

/** The bath or the brush is over: it is free to choose again, as if just touched. */
export function letGo(r: RoutineState): void {
  r.held = null
  r.idle = r.alone = 0
  if (r.routine === 'bathing' || r.routine === 'brushing') enter(r, 'none')
}

/**
 * Busy in its place (a meal, the scale, the mud, the bath or the brush), there and turning in, or
 * making way: nobody shoves it.
 */
export const staysPut = (r: RoutineState): boolean =>
  !!r.held ||
  r.routine === 'eating' ||
  r.routine === 'onScale' ||
  r.routine === 'splashing' ||
  r.routine === 'settling' ||
  (r.routine === 'sleeping' && r.nap === 'floor') ||
  r.there ||
  r.waitT > 0

/** How far a puppy in the way of a chase walks off, and the least that counts as making way. */
const STEP_ASIDE = 0.6,
  STEP_ASIDE_MIN = 0.4
/** Turns off the way straight from the ball tried in turn, when the edge is behind the puppy. */
const ASIDE_TURNS = [0, Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, (-2 * Math.PI) / 3] as const

/**
 * Standing in the way of a chase: it walks a short way off from the ball at (x, z), straight
 * away when there is room, else turning off along the edge of the play area. Returns how far.
 */
export function stepAside(
  m: MotionState,
  x: number,
  z: number,
  clamp: (x: number, z: number) => [number, number],
): number {
  const ax = m.pos.x - x,
    az = m.pos.z - z,
    l = Math.hypot(ax, az),
    ux = l > 1e-6 ? ax / l : 1,
    uz = l > 1e-6 ? az / l : 0
  let bx = m.pos.x,
    bz = m.pos.z,
    most = -1
  for (const turn of ASIDE_TURNS) {
    const c = Math.cos(turn),
      s = Math.sin(turn)
    const [tx, tz] = clamp(
      m.pos.x + (ux * c - uz * s) * STEP_ASIDE,
      m.pos.z + (ux * s + uz * c) * STEP_ASIDE,
    )
    const moved = Math.hypot(tx - m.pos.x, tz - m.pos.z)
    if (moved > most) {
      most = moved
      bx = tx
      bz = tz
    }
    if (moved >= STEP_ASIDE_MIN) break
  }
  goTo(m, bx, bz, { happy: 0, energy: 0, gait: 'walk', clamp })
  return most
}

/** Walks on to `r.aside` until there or `asideT` runs out, whatever stopped it on the way. */
function keepAside(r: RoutineState, m: MotionState, ctx: RoutineCtx, dt: number) {
  r.asideT -= dt
  if (Math.hypot(r.aside.x - m.pos.x, r.aside.z - m.pos.z) <= ARRIVED) r.asideT = 0
  else if (!m.goal) {
    walk.clamp = ctx.clamp
    goTo(m, r.aside.x, r.aside.z, walk)
  }
}

/** The routines that walk to a place with `approach`. */
const WALKS: ReadonlySet<Routine> = new Set(['toBed', 'toBowl', 'toMud', 'toGarden', 'toScale'])

/** On its way to a place and not there yet: turning round in its bed counts as there. */
export const walking = (r: RoutineState): boolean => WALKS.has(r.routine) && !r.there

/** Whether two bodies touch, or all but: within REACHED of each other, where one stops short. */
function touching(a: Body, b: Body): boolean {
  for (let i = 0; i < SPHERES; i++)
    for (let k = 0; k < SPHERES; k++) {
      const p = sphereAt(a, i),
        q = sphereAt(b, k)
      if (Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r + REACHED) return true
    }
  return false
}
const REACHED = 0.1

/**
 * Two puppies on their way to their own places that have got no nearer for STUCK seconds, their
 * bodies touching, would push at each other for ever: the one further from its place steps aside
 * and waits until the other is there (YIELD_WAIT at most). One standing about in a walker's way,
 * `free` to move, steps aside out of it. Those eating, asleep or on the scale are not walking and
 * stay put. Call it once a frame, after the bodies are kept apart.
 */
export function giveWay(
  rs: readonly RoutineState[],
  ms: readonly MotionState[],
  bodies: readonly Body[],
  free: readonly boolean[],
  clamp: RoutineCtx['clamp'],
  spots?: Spots,
): void {
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!
    // The one it walks round, where its body is now
    if (r.blockT > 0) {
      const k = ms.indexOf(r.blockedBy!)
      if (k < 0) r.blockT = 0
      else {
        const round = r.blocker[0],
          body = bodies[k]!
        round.x = body.chest.x
        round.z = body.chest.z
        round.r = reachOf(body)
      }
    }
    if (!walking(r) || r.waitT > 0 || r.stuckT < STUCK) continue
    for (let j = 0; j < rs.length; j++) {
      const o = rs[j]!
      if (j === i || !touching(bodies[i]!, bodies[j]!)) continue
      // Waiting for it in its way after all: it makes way again, or backs off
      if (walking(o) && o.waitT > 0) {
        if (!makeWay(ms[j]!, ms[i]!, r, spots, clamp)) backOff(o, ms[j]!, ms[i]!, r.target, clamp)
        r.stuckT = 0
        r.nearest = Infinity
        break
      }
      if (walking(o)) {
        const far = (k: number) =>
          Math.hypot(rs[k]!.target.x - ms[k]!.pos.x, rs[k]!.target.z - ms[k]!.pos.z)
        const [y, w] = far(i) >= far(j) ? [i, j] : [j, i]
        const ry = rs[y]!
        // Off to a spot clear of the furniture and of the other's way, else straight back
        if (!makeWay(ms[y]!, ms[w]!, rs[w]!, spots, clamp))
          backOff(ry, ms[y]!, ms[w]!, rs[w]!.target, clamp)
        ry.waitT = YIELD_WAIT
        ry.yieldTo = rs[w]!
        // Made to wait again and again on its way round: the other way round, then
        if (++ry.yields >= 2) {
          ry.around.side = -ry.around.side
          ry.yields = 0
        }
        rs[w]!.stuckT = 0
        rs[w]!.nearest = Infinity
        break
      }
    }
    // One standing about in the way, as for a chase after the ball
    if (r.waitT > 0 || r.stuckT < STUCK) continue
    let k = inTheWay(ms, bodies, free, i, r.target),
      moved = k >= 0 ? stepAside(ms[k]!, r.target.x, r.target.z, clamp) : 0
    if (k < 0) {
      // Or one it is pressed up against, where the edge leaves no way past: away from the walker
      k = 0
      while (k < rs.length && (k === i || !free[k] || !touching(bodies[i]!, bodies[k]!))) k++
      if (k === rs.length) continue
      moved = stepAside(ms[k]!, ms[i]!.pos.x, ms[i]!.pos.z, clamp)
    }
    r.stuckT = 0
    // It walks round the other while that steps aside, and the other keeps at it if pushed
    r.blockedBy = ms[k]!
    r.blockT = BLOCK_TIME
    if (ms[k]!.goal) {
      rs[k]!.aside.copy(ms[k]!.goal!)
      rs[k]!.asideT = ASIDE_TIME
    }
    if (moved >= STEP_ASIDE_MIN && r.asked++ === 0) continue
    // Penned in, or asked already for nothing: the walker backs straight off and waits a moment,
    // leaving the other room to get out of its way
    r.asked = 0
    r.nearest = Infinity
    backOff(r, ms[i]!, ms[k]!, ms[i]!.pos, clamp, [bodies[i]!, bodies[k]!])
    // The other walks off clear of its way, or else to where it stood before it backed off
    const mk = ms[k]!,
      rk = rs[k]!
    rk.aside.copy(makeWay(mk, ms[i]!, r, spots, clamp) ? mk.goal! : ms[i]!.pos)
    rk.asideT = ASIDE_TIME
    r.waitT = BACK_WAIT
    r.yieldTo = null
  }
}

/**
 * The last resort of one that cannot make way: it backs straight off along the way `other` walks
 * to `to`, as far as the play area lets it, turning off along the edge where that is behind it,
 * and with no room for even a short step it stands still. Either way the bodies stay apart. Given
 * the bodies (its own, then the other's), it turns round only the way that swings its head off
 * the other: the other way, the turn would only be taken back.
 */
function backOff(
  r: RoutineState,
  m: MotionState,
  other: MotionState,
  to: Vec3,
  clamp: RoutineCtx['clamp'],
  bodies?: readonly [Body, Body],
): void {
  r.backedOff++
  let ux = to.x - other.pos.x,
    uz = to.z - other.pos.z,
    l = Math.hypot(ux, uz)
  // The other is there already: away from it
  if (l < 1e-6) {
    ux = m.pos.x - other.pos.x
    uz = m.pos.z - other.pos.z
    l = Math.hypot(ux, uz)
  }
  m.goal = null
  if (l < 1e-6) return
  ux /= l
  uz /= l
  const clear = bodies ? clearTurn(m.heading, bodies[0], bodies[1]) : 0
  let bx = 0,
    bz = 0,
    most = BACK_LEAST
  for (const turn of BACK_TURNS) {
    const c = Math.cos(turn),
      n = Math.sin(turn),
      [x, z] = clamp(m.pos.x + (ux * c - uz * n) * BACK, m.pos.z + (ux * n + uz * c) * BACK),
      moved = Math.hypot(x - m.pos.x, z - m.pos.z)
    if (moved <= most) continue
    const swing = angle(Math.atan2(x - m.pos.x, z - m.pos.z) - m.heading)
    if (clear && Math.abs(swing) > SWING && Math.sign(swing) !== clear) continue
    most = moved
    bx = x
    bz = z
    if (moved >= BACK - 0.05) break
  }
  if (most > BACK_LEAST) goTo(m, bx, bz, { happy: 0, energy: 0, gait: 'walk', clamp })
}

/** How far it backs off, and the least step worth taking. */
const BACK = 0.6,
  BACK_LEAST = 0.2
/** A turn up to this far, in radians, barely swings the head: either way will do. */
const SWING = 0.4

/**
 * Which way a puppy facing `heading` turns its head (`own.head`) off the nearest sphere of
 * `other`: +1 turning with its heading, −1 against it.
 */
function clearTurn(heading: number, own: Body, other: Body): number {
  const h = own.head
  let qx = 0,
    qz = 0,
    near = Infinity
  for (let k = 0; k < SPHERES; k++) {
    const q = sphereAt(other, k),
      d = Math.hypot(q.x - h.x, q.z - h.z)
    if (d < near) {
      near = d
      qx = q.x
      qz = q.z
    }
  }
  // Turning by +a moves the head along (cos h, −sin h)
  return Math.sign(Math.cos(heading) * (h.x - qx) - Math.sin(heading) * (h.z - qz))
}

/** Turns off straight back tried in turn, where the edge of the play area is behind it. */
const BACK_TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2] as const

/** How far the one making way walks off, at most, and how wide it keeps of furniture and paths. */
const MAKE_WAY = [0.6, 0.45, 0.3],
  WAY_CLEAR = 0.2,
  PATH_CLEAR = 0.5

/** How far (x, z) is from the segment from (ax, az) to (bx, bz). */
function offSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const lx = bx - ax,
    lz = bz - az,
    l2 = lx * lx + lz * lz,
    u = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * lx + (z - az) * lz) / l2)) : 0
  return Math.hypot(x - ax - u * lx, z - az - u * lz)
}

/**
 * Walks `m` a step off to where it is clear of every piece and of the way `other` walks, by
 * `way.via` to `way.target`: the shortest such step. False when there is none.
 */
function makeWay(
  m: MotionState,
  other: MotionState,
  way: Pick<RoutineState, 'via' | 'target'>,
  spots: Spots | undefined,
  clamp: RoutineCtx['clamp'],
): boolean {
  const pieces = spots
    ? [...spots.beds, ...spots.bowls, ...(spots.scaleAway ? [] : [spots.scale])]
    : []
  const { via, target: to } = way
  const offPath = (x: number, z: number) =>
    Math.min(
      offSegment(x, z, other.pos.x, other.pos.z, via.x, via.z),
      offSegment(x, z, via.x, via.z, to.x, to.z),
    )
  for (const reach of MAKE_WAY)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      const [x, z] = clamp(m.pos.x + Math.sin(a) * reach, m.pos.z + Math.cos(a) * reach)
      if (Math.hypot(x - m.pos.x, z - m.pos.z) < reach - 0.05) continue
      if (offPath(x, z) < PATH_CLEAR) continue
      if (pieces.some((p) => inOval(p, x, z, WAY_CLEAR))) continue
      goTo(m, x, z, { happy: 0, energy: 0, gait: 'walk', clamp })
      return true
    }
  return false
}

/**
 * «Pesar»: it walks to the scale and stands on it for WEIGH_TIME, then steps off. A sleeper
 * stretches first. A call, a trick or the ball calls it off.
 */
export function goWeigh(r: RoutineState, m: MotionState): void {
  r.idle = r.alone = 0
  r.weigh = true
  if (r.routine === 'sleeping') return enter(r, 'stretch')
  if (r.routine !== 'stretch') stopHere(r, m, 'toScale')
}

/** On its way to the scale or on it: the scale is its for now. */
export const weighing = (r: RoutineState): boolean =>
  r.routine === 'toScale' || r.routine === 'onScale' || (r.weigh && r.routine === 'stretch')

/**
 * Sets off for the middle of the puddle, to stamp about, roll or dig in it and come back. There it
 * turns side on to the screen, its head towards the room: the puddle lies by the play area's left
 * edge, and so it shows its whole body.
 */
export function goToMud(
  r: RoutineState,
  m: MotionState,
  spots: Spots,
  clamp: RoutineCtx['clamp'],
): void {
  const { center, facing } = spots.mud
  const [x, z] = clamp(center.x, center.z)
  r.from.copy(m.pos)
  r.target.set(x, 0, z)
  r.heading = facing + IN_MUD_TURN
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
  r.alone += dt
  // Pushed off its place while turning in there (the scale kept clear, a new layout): back first
  if (r.there && Math.hypot(r.target.x - m.pos.x, r.target.z - m.pos.z) > ARRIVED) {
    r.there = false
    r.turnLeft = null
    m.face = null
  }
  r.begAgo += dt
  r.mudAgo += dt
  r.fedAgo += dt
  if (r.routine !== 'sleeping') r.awake += dt
  r.sulking = ctx.care.messes.length ? r.sulking + dt : 0
  r.passing += dt
  if (m.speed > MOVING) r.moving += dt
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
  if (r.passing >= CARE_FLUSH) {
    ev.care = settle(getHungry(ev.care, r.passing), r.passing)
    r.passing = 0
  }
  if (r.moving >= CARE_FLUSH) {
    ev.care = exercise(ev.care, r.moving, ctx.breed)
    r.moving = 0
  }
  if (ctx.busy && !keepsEating(r, ctx.care) && !r.held) {
    r.idle = r.alone = 0
    r.weigh = false
    // Up at once from a nap for the ball
    if (r.nap && m.pose !== 'stand') setPose(m, 'stand')
    // The stamp's heading goes with it, or play would start with a stray turn, and it gets up
    if (r.routine === 'splashing' || r.routine === 'toMud') m.face = null
    if (wallowing(r, m)) setPose(m, 'stand')
    if (r.routine === 'relieving') m.sitGoal = m.bowGoal = 0
    if (r.routine !== 'none') enter(r, 'none')
  } else {
    if (r.routine === 'none') choose(r, m, ctx, dt)
    STEPS[r.routine]?.(r, m, ctx, ev, dt)
  }
  if (r.routine === 'none' && !ctx.busy && r.asideT > 0) keepAside(r, m, ctx, dt)
  else r.asideT = 0
  // A meal counts once it is over, however it ended
  if (r.routine !== 'eating' && r.eaten > 0) {
    ev.care = feed(ev.care, ctx.breed, r.eaten)
    r.eaten = 0
    r.fedAgo = 0
  }
  return ev
}
