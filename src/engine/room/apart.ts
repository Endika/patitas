import type { Vec3 } from '@/engine/math'
import type { MotionState } from '@/engine/motion/locomotion'
import { shiftBody, sphereAt, SPHERES, type Body } from './bodies'

/** Moves a floor point back into the play area, in place. */
export type ClampTo = (p: Vec3) => void

/**
 * The most `keepApart` moves a puppy in one frame. A pair it cannot part within that keeps
 * overlapping a little for the next frames, which is never a jump.
 */
export const APART_STEP = 0.05

/** Times round all the pairs at most. */
const SWEEPS = 4
/** Rounds of pushing a pair apart: the edge of the play area can turn a push and leave them touching. */
const ROUNDS = 4
/** Left this far apart, so rounding does not leave them touching. */
const SLACK = 1e-6
/** Pushed less than this short of parting counts as parted. */
const PARTED = 1e-6
/** Ways to push a pair apart, as turns off the line between them. */
const TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2] as const
/**
 * Two walking into each other keep to their right, so they get past: turns that way only, the
 * slant first. Straight apart would stop them nose to nose for ever.
 */
const KEEP_RIGHT = [Math.PI / 4, 0, Math.PI / 2] as const
/** How much a kept-right slant counts of what it moves them, so it wins over straight apart. */
const SLANT_COST = 0.5
/** The most a nudge moves a puppy standing in a walker's way. */
const NUDGE = 0.05

const NONE: readonly MotionState[] = [],
  NO_BODIES: readonly Body[] = []
/** The pass in progress: set by `keepApart`, so the helpers take no arrays. */
let states = NONE,
  bodies = NO_BODIES,
  clampTo: ClampTo | undefined,
  fixed: readonly boolean[] | null = null
/** Where each puppy stood when the pass began, as x, z pairs: no puppy moves APART_STEP from it. */
let starts = new Float64Array(8)
/** The frame's length, to take back a turn this frame made: 0 takes back none. */
let frameDt = 0

const still = (i: number) => states[i]!.pose === 'sleep' || !!fixed?.[i]

/**
 * Pushes the puppies apart until no sphere of one is in a sphere of another, never more than
 * APART_STEP each in a frame, each body moving with its puppy. A sleeper, and those `pinned` (busy
 * in their place: eating, on the scale, in the bath), stay put and the other takes the whole push. Each pair parts the way that moves them
 * least, with `clamp` keeping them in the play area, where a pinned puppy can only slide along
 * the edge. Where that is not enough, a puppy that turned into the other this frame (`dt`) turns
 * back: a long body swings its head further than any step. A walker nudges one standing in its way aside; when it cannot, the walker stops short,
 * and two walkers pinned into each other both stop, rather than push on for ever.
 */
export function keepApart(
  s: readonly MotionState[],
  b: readonly Body[],
  clamp?: ClampTo,
  pinned: readonly boolean[] | null = null,
  dt = 0,
): void {
  frameDt = dt
  states = s
  bodies = b
  clampTo = clamp
  fixed = pinned
  if (starts.length < 2 * s.length) starts = new Float64Array(4 * s.length)
  for (let i = 0; i < s.length; i++) {
    starts[2 * i] = s[i]!.pos.x
    starts[2 * i + 1] = s[i]!.pos.z
  }
  // Parting one pair can push one of them into a third, so the pairs go round until all are clear
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    let moved = false
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) moved = part(i, j) || moved
    if (!moved) break
  }
  states = NONE
  bodies = NO_BODIES
  clampTo = undefined
  fixed = null
}

/** Moves puppy `i` by (dx, dz), kept in the play area and within APART_STEP of its start. */
function moveBy(i: number, dx: number, dz: number): number {
  const p = states[i]!.pos,
    x0 = p.x,
    z0 = p.z
  p.x += dx
  p.z += dz
  clampTo?.(p)
  const sx = starts[2 * i]!,
    sz = starts[2 * i + 1]!,
    ox = p.x - sx,
    oz = p.z - sz,
    o = Math.hypot(ox, oz)
  // The play area is convex: a point between two inside it is inside too
  if (o > APART_STEP) {
    p.x = sx + (ox * APART_STEP) / o
    p.z = sz + (oz * APART_STEP) / o
  }
  shiftBody(bodies[i]!, p.x - x0, p.z - z0)
  return Math.hypot(p.x - x0, p.z - z0)
}

function placeAt(i: number, x: number, z: number) {
  const p = states[i]!.pos
  shiftBody(bodies[i]!, x - p.x, z - p.z)
  p.x = x
  p.z = z
}

/**
 * How far `b` has to move away from `a` along (nx, nz) on the floor for no sphere of one to be in a
 * sphere of the other: the least push that clears every pair, never one that sends a pair clear
 * of each other through another pair. 0 when they do not overlap.
 */
export function apartBy(a: Body, b: Body, nx: number, nz: number): number {
  let t = 0
  // Each pass moves past every pair still overlapping at `t`; t only grows, so nine passes do
  for (let pass = 0; pass <= SPHERES * SPHERES; pass++) {
    let grew = false
    for (let i = 0; i < SPHERES; i++)
      for (let k = 0; k < SPHERES; k++) {
        const p = sphereAt(a, i),
          q = sphereAt(b, k),
          reach = p.r + q.r,
          dy = q.y - p.y
        if (Math.abs(dy) >= reach) continue
        // Along the push, the pair overlaps between the two t where |offset + t·n| = √(reach² − dy²)
        const dx = q.x - p.x,
          dz = q.z - p.z,
          along = dx * nx + dz * nz,
          disc = along * along - (dx * dx + dz * dz) + reach * reach - dy * dy
        if (disc <= 0) continue
        const root = Math.sqrt(disc)
        if (t > -along - root && t < root - along) {
          t = root - along
          grew = true
        }
      }
    if (!grew) break
  }
  return t
}

/** Whether two bodies are too far apart to touch, judged from their chests: a cheap first look. */
function apartFar(a: Body, b: Body): boolean {
  return Math.hypot(a.chest.x - b.chest.x, a.chest.z - b.chest.z) > reachOf(a) + reachOf(b)
}

/** How far along the floor a body reaches from its chest's middle. */
function reachOf(b: Body): number {
  const c = b.chest
  return Math.max(
    c.r,
    Math.hypot(b.head.x - c.x, b.head.z - c.z) + b.head.r,
    Math.hypot(b.rump.x - c.x, b.rump.z - c.z) + b.rump.r,
  )
}

/** The deepest overlap between two bodies, and the way along the floor that undoes it. */
const contact = { depth: 0, nx: 0, nz: 0 }

/** Finds `contact` from `a` towards `b`; false when no spheres overlap. */
function touching(a: Body, b: Body): boolean {
  contact.depth = 0
  for (let i = 0; i < SPHERES; i++)
    for (let k = 0; k < SPHERES; k++) {
      const p = sphereAt(a, i),
        q = sphereAt(b, k),
        reach = p.r + q.r,
        dy = q.y - p.y
      if (Math.abs(dy) >= reach) continue
      const dx = q.x - p.x,
        dz = q.z - p.z,
        flat = Math.hypot(dx, dz),
        depth = Math.sqrt(reach * reach - dy * dy) - flat
      if (depth <= contact.depth || flat < 1e-6) continue
      contact.depth = depth
      contact.nx = dx / flat
      contact.nz = dz / flat
    }
  return contact.depth > 0
}

/**
 * Walker `w` bumping into `idle`, who stands about, moves it on and off its path: to the side of
 * the path it stands on, or the other side when the edge of the play area is there. Returns
 * whether they are clear of each other.
 */
function nudgeAside(w: number, idle: number): boolean {
  const mw = states[w]!,
    mi = states[idle]!,
    bw = bodies[w]!,
    bi = bodies[idle]!
  if (!mw.goal || !touching(bw, bi)) return true
  const { nx, nz } = contact
  const tx = mw.goal.x - mw.pos.x,
    tz = mw.goal.z - mw.pos.z,
    tl = Math.hypot(tx, tz)
  if (tl < 1e-6) return false
  // Walking off away from it: nothing to make way for
  if (tx * (mi.pos.x - mw.pos.x) + tz * (mi.pos.z - mw.pos.z) <= 0) return true
  const px = -tz / tl,
    pz = tx / tl,
    on = (mi.pos.x - mw.pos.x) * px + (mi.pos.z - mw.pos.z) * pz >= 0 ? 1 : -1,
    x0 = mi.pos.x,
    z0 = mi.pos.z
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? on : -on,
      l = Math.hypot(nx + side * px, nz + side * pz),
      ux = l > 1e-6 ? (nx + side * px) / l : side * px,
      uz = l > 1e-6 ? (nz + side * pz) / l : side * pz,
      t = apartBy(bw, bi, ux, uz) + SLACK
    if (t > NUDGE) continue
    if (moveBy(idle, ux * t, uz * t) >= t - 1e-9) return true
    placeAt(idle, x0, z0)
  }
  return false
}

/** Each way tried for a pair: its direction and how far along it parts them, as ux, uz, d. */
const way = new Float64Array(3 * TURNS.length)

/** The best way found to part a pair: how far short of parting it leaves them, and how far it moves them. */
const choice = { k: -1, short: Infinity, moved: Infinity }

/**
 * Pushes puppies `i` and `j` apart until their spheres no longer overlap, or as far as a frame
 * allows. Returns whether either moved.
 */
function part(i: number, j: number): boolean {
  const a = states[i]!,
    b = states[j]!,
    sa = still(i),
    sb = still(j)
  if ((sa && sb) || apartFar(bodies[i]!, bodies[j]!)) return false
  const pa = a.pos,
    pb = b.pos,
    ax0 = pa.x,
    az0 = pa.z,
    bx0 = pb.x,
    bz0 = pb.z
  if (!sa && !sb && !a.goal !== !b.goal) {
    const w = a.goal ? i : j
    // Backed against the edge, the one standing cannot make way: the walker stops short of it
    if (!nudgeAside(w, w === i ? j : i)) states[w]!.goal = null
  }
  let pushed = false
  for (let round = 0; round < ROUNDS; round++) {
    const rx = pb.x - pa.x,
      rz = pb.z - pa.z,
      r = Math.hypot(rx, rz),
      nx = r > 1e-6 ? rx / r : 1,
      nz = r > 1e-6 ? rz / r : 0
    if (apartBy(bodies[i]!, bodies[j]!, nx, nz) <= 0) break
    pushed = true
    const lean = a.goal && b.goal && !sa && !sb ? keepRight(a.heading, b.heading, nx, nz) : 0,
      turns = lean ? KEEP_RIGHT : TURNS
    // Of the ways that part them in full, the one that moves them least; failing all, the nearest
    choice.k = -1
    choice.short = Infinity
    choice.moved = Infinity
    const ax = pa.x,
      az = pa.z,
      bx = pb.x,
      bz = pb.z
    for (let k = 0; k < turns.length; k++) {
      const turn = (lean || 1) * turns[k]!,
        ux = nx * Math.cos(turn) - nz * Math.sin(turn),
        uz = nx * Math.sin(turn) + nz * Math.cos(turn),
        d = apartBy(bodies[i]!, bodies[j]!, ux, uz) + SLACK,
        cost = lean && k === 0 ? SLANT_COST : 1
      way[3 * k] = ux
      way[3 * k + 1] = uz
      way[3 * k + 2] = d
      // Parting them along it moves them at least d: no better than a way that parts them already
      if (choice.short < PARTED && d * cost >= choice.moved) continue
      push(i, j, ux, uz, d)
      const moved = (Math.hypot(pa.x - ax, pa.z - az) + Math.hypot(pb.x - bx, pb.z - bz)) * cost,
        short = Math.max(0, pushShort)
      const better =
        short < PARTED
          ? choice.short >= PARTED || moved < choice.moved
          : short < choice.short - 1e-9 || (short < choice.short + 1e-9 && moved < choice.moved)
      if (better) {
        choice.k = k
        choice.short = short
        choice.moved = moved
      }
      placeAt(i, ax, az)
      placeAt(j, bx, bz)
    }
    const k = choice.k
    push(i, j, way[3 * k]!, way[3 * k + 1]!, way[3 * k + 2]!)
    // Two walking into each other against the edge cannot get past: each stops where it is
    if (round === 0 && a.goal && b.goal && choice.short >= PARTED) {
      stopIfInto(a, b)
      stopIfInto(b, a)
    }
    if (choice.short >= PARTED) break
  }
  if (pushed && frameDt > 0 && touching(bodies[i]!, bodies[j]!)) {
    if (!sa) unturn(i, j)
    if (!sb && touching(bodies[i]!, bodies[j]!)) unturn(j, i)
  }
  // Walking into a sleeper or the one on the scale, which will not move: it stops short
  if (pushed && sa !== sb) stopIfInto(sa ? b : a, sa ? a : b, AHEAD)
  return pa.x !== ax0 || pa.z !== az0 || pb.x !== bx0 || pb.z !== bz0
}

/** Takes back puppy `i`'s turn this frame when that leaves it less deep in `other`. */
function unturn(i: number, other: number) {
  const m = states[i]!,
    turn = m.yawRate * frameDt
  if (turn === 0) return
  const deep = contact.depth
  turnBody(i, -turn)
  if (touching(bodies[i]!, bodies[other]!) && contact.depth >= deep) {
    turnBody(i, turn)
    touching(bodies[i]!, bodies[other]!)
    return
  }
  m.heading -= turn
  m.yawRate = 0
}

/** Turns puppy `i`'s body by `a` round its root, as a turn of its heading would. */
function turnBody(i: number, a: number) {
  const p = states[i]!.pos,
    b = bodies[i]!,
    c = Math.cos(a),
    s = Math.sin(a)
  for (let k = 0; k < SPHERES; k++) {
    const q = sphereAt(b, k),
      dx = q.x - p.x,
      dz = q.z - p.z
    // A heading h puts the snout at (sin h, cos h): turning by a rotates (x, z) that way
    q.x = p.x + dx * c + dz * s
    q.z = p.z - dx * s + dz * c
  }
}

/** How far short of parting the last `push` left its pair, along its own way. */
let pushShort = 0

/**
 * Pushes `j` away from `i` by `d` along (ux, uz): half each, all of it on the one awake when the other stays put, and on whichever is free
 * when the other is against the edge.
 */
function push(i: number, j: number, ux: number, uz: number, d: number) {
  const pa = states[i]!.pos,
    pb = states[j]!.pos,
    ax = pa.x,
    az = pa.z,
    bx = pb.x,
    bz = pb.z
  if (still(i)) moveBy(j, ux * d, uz * d)
  else if (still(j)) moveBy(i, -ux * d, -uz * d)
  else {
    const movedA = moveBy(i, (-ux * d) / 2, (-uz * d) / 2),
      movedB = moveBy(j, (ux * d) / 2, (uz * d) / 2)
    const left = d - ((pb.x - bx - (pa.x - ax)) * ux + (pb.z - bz - (pa.z - az)) * uz)
    // One of them is held back, so the other takes what is left of the push
    if (left > 1e-9) {
      if (movedA >= movedB) moveBy(i, -ux * left, -uz * left)
      else moveBy(j, ux * left, uz * left)
    }
  }
  pushShort = d - ((pb.x - bx - (pa.x - ax)) * ux + (pb.z - bz - (pa.z - az)) * uz)
}

/** Within this cosine of straight ahead, a puppy that will not move is in a walker's way. */
const AHEAD = 0.5

/** Drops `m`'s goal when it is walking towards `other`: within `cos` of straight at it. */
function stopIfInto(m: MotionState, other: MotionState, cos = 0) {
  const g = m.goal
  if (!g) return
  const gx = g.x - m.pos.x,
    gz = g.z - m.pos.z,
    ox = other.pos.x - m.pos.x,
    oz = other.pos.z - m.pos.z
  if (gx * ox + gz * oz > cos * Math.hypot(gx, gz) * Math.hypot(ox, oz)) m.goal = null
}

/**
 * Which way, as a turn off the line from `a` to `b` (along nx, nz), takes each of them towards its
 * own right: +1 or −1, or 0 when they walk the same way and neither has to give.
 */
function keepRight(ha: number, hb: number, nx: number, nz: number): -1 | 0 | 1 {
  // Each one's right is (−cos h, sin h); the turn to +90° off the line is (−nz, nx)
  const side = (Math.cos(ha) - Math.cos(hb)) * -nz + (Math.sin(hb) - Math.sin(ha)) * nx
  return side > 0.3 ? 1 : side < -0.3 ? -1 : 0
}
