import type { Vec3 } from '@/engine/math'
import type { FetchState } from '@/engine/motion/fetch'
import type { MotionState } from '@/engine/motion/locomotion'
import type { BallState } from './ball'
import { shiftBody, sphereAt, SPHERES, type Body } from './bodies'

type Clamp = (x: number, z: number) => [number, number]

/**
 * Keeps puppies from standing inside each other: overlapping bodies are pushed apart evenly,
 * and two walking to the same spot get spots `minDist` apart. A walker heading where another
 * stands keeps its goal and nudges that one aside, so a chase can always reach the ball. With
 * `clamp`, bodies and goals stay in the play area: a puppy pinned against its edge is only
 * moved along it, and the other one takes the rest of the push. A sleeper stays in its place in
 * the bed and the awake one takes the whole push.
 *
 * Without `bodies` a body is a circle `minDist` across. With them (one per state, in the same
 * order, moved along with each push) the puppies part until no sphere of one is in a sphere of
 * the other, so they may stand closer side by side than head to tail. Pinned against the edge,
 * a walker that cannot get past stops where it is rather than push on for ever.
 */
export function separate(
  states: MotionState[],
  minDist = 0.45,
  clamp?: Clamp,
  bodies?: readonly Body[],
): void {
  // Parting one pair can push one of them into a third, so the pairs go round until all are clear
  for (let sweep = 0; bodies && sweep < SWEEPS; sweep++) {
    let moved = false
    for (let i = 0; i < states.length; i++)
      for (let j = i + 1; j < states.length; j++)
        moved = part(states[i]!, states[j]!, bodies[i]!, bodies[j]!, clamp) || moved
    if (!moved) break
  }
  for (let i = 0; i < states.length; i++)
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i]!,
        b = states[j]!
      const sa = a.pose === 'sleep',
        sb = b.pose === 'sleep'
      if (!bodies) {
        if (sa !== sb) shove(sa ? a.pos : b.pos, sa ? b.pos : a.pos, minDist, clamp)
        else push(a.pos, b.pos, minDist, clamp)
      }
      if (a.goal && b.goal) push(a.goal, b.goal, minDist, clamp)
    }
}

/** Times round all the pairs at most. */
const SWEEPS = 4

/**
 * Rounds of pushing a pair apart: one clears them, but where the edge of the play area turns a
 * push aside the pair may still touch, and a new round pushes again from where they are.
 */
const PART_ROUNDS = 16
/**
 * Ways to push a pair apart, as turns off the line between them: straight apart first, then
 * slanting, then sideways, for two pinned against the edges to slide past each other along them.
 */
const PART_TURNS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2] as const
/** Two walking into each other keep to their right: slanting that way first, so they get past. */
const KEEP_RIGHT = [Math.PI / 4, 0, -Math.PI / 4, Math.PI / 2, -Math.PI / 2] as const
/** Left this far apart, so rounding does not leave them touching. */
const PART_SLACK = 1e-6

/**
 * How far `b` has to move away from `a` along (nx, nz) on the floor for no sphere of one to be in a
 * sphere of the other: the least push that clears every pair, never one that sends a pair clear
 * of each other through another pair.
 */
function apartBy(a: Body, b: Body, nx: number, nz: number): number {
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

/** The most a nudge moves a puppy in one go: more would show as a jump. */
const NUDGE_MAX = 0.05

/**
 * A walker bumping into a puppy that stands about moves it on and off its path, to the side of
 * the path it stands on, or the other side when the edge of the play area is there. Returns
 * whether they are clear of each other.
 */
function nudgeAside(w: MotionState, idle: MotionState, bw: Body, bi: Body, clamp?: Clamp) {
  if (!w.goal || !touching(bw, bi)) return true
  const { nx, nz } = contact
  const tx = w.goal.x - w.pos.x,
    tz = w.goal.z - w.pos.z,
    tl = Math.hypot(tx, tz)
  if (tl < 1e-6) return false
  const px = -tz / tl,
    pz = tx / tl,
    on = (idle.pos.x - w.pos.x) * px + (idle.pos.z - w.pos.z) * pz >= 0 ? 1 : -1,
    x0 = idle.pos.x,
    z0 = idle.pos.z
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? on : -on,
      l = Math.hypot(nx + side * px, nz + side * pz),
      ux = l > 1e-6 ? (nx + side * px) / l : side * px,
      uz = l > 1e-6 ? (nz + side * pz) / l : side * pz,
      t = apartBy(bw, bi, ux, uz) + PART_SLACK
    if (t > NUDGE_MAX) continue
    if (move(idle.pos, ux * t, uz * t, clamp) >= t - 1e-9) {
      shiftBody(bi, idle.pos.x - x0, idle.pos.z - z0)
      return true
    }
    idle.pos.x = x0
    idle.pos.z = z0
  }
  return false
}

/**
 * Pushes two bodies apart until their spheres no longer overlap. A walker nudges one standing
 * about aside; otherwise they part along the line between them, or slanting off it where the edge
 * of the play area holds them, and a sleeper stays put. Each body moves with its puppy. Returns
 * whether either moved.
 */
function part(a: MotionState, b: MotionState, ba: Body, bb: Body, clamp?: Clamp): boolean {
  const sa = a.pose === 'sleep',
    sb = b.pose === 'sleep',
    pa = a.pos,
    pb = b.pos,
    ax0 = pa.x,
    az0 = pa.z,
    bx0 = pb.x,
    bz0 = pb.z
  if (!sa && !sb && !a.goal !== !b.goal) {
    const w = a.goal ? a : b,
      bw = a.goal ? ba : bb,
      bi = a.goal ? bb : ba
    // Backed against the edge, the one standing cannot make way: the walker stops short of it
    if (!nudgeAside(w, w === a ? b : a, bw, bi, clamp)) w.goal = null
  }
  for (let round = 0; round < PART_ROUNDS; round++) {
    const ax = pa.x,
      az = pa.z,
      bx = pb.x,
      bz = pb.z,
      rx = bx - ax,
      rz = bz - az,
      r = Math.hypot(rx, rz),
      nx = r > 1e-6 ? rx / r : 1,
      nz = r > 1e-6 ? rz / r : 0
    if (apartBy(ba, bb, nx, nz) <= 0)
      return pa.x !== ax0 || pa.z !== az0 || pb.x !== bx0 || pb.z !== bz0
    const lean = a.goal && b.goal && !sa && !sb ? keepRight(a.heading, b.heading, nx, nz) : 0,
      turns = lean ? KEEP_RIGHT : PART_TURNS
    // The first way that parts them in full; failing all, the one that gets furthest
    let best = -1,
      bestShare = -Infinity,
      held = false
    for (let k = 0; k <= turns.length; k++) {
      held = k > 0
      const turn = (lean || 1) * turns[k < turns.length ? k : best]!,
        c = Math.cos(turn),
        s = Math.sin(turn),
        ux = nx * c - nz * s,
        uz = nx * s + nz * c,
        t = apartBy(ba, bb, ux, uz) + PART_SLACK
      pushApart(pa, pb, ux, uz, t, sa, sb, clamp)
      if (k === turns.length) break
      const share = ((pb.x - bx - (pa.x - ax)) * ux + (pb.z - bz - (pa.z - az)) * uz) / t
      if (share >= 1 - 1e-9) break
      if (share > bestShare) {
        bestShare = share
        best = k
      }
      pa.x = ax
      pa.z = az
      pb.x = bx
      pb.z = bz
    }
    shiftBody(ba, pa.x - ax, pa.z - az)
    shiftBody(bb, pb.x - bx, pb.z - bz)
    // Two walking into each other against the edge cannot get past: each stops where it is
    if (held && round === 0 && a.goal && b.goal) {
      stopIfInto(a, b)
      stopIfInto(b, a)
    }
  }
  return true
}

/** Drops `m`'s goal when it is walking towards `other`. */
function stopIfInto(m: MotionState, other: MotionState) {
  const g = m.goal
  if (
    g &&
    (g.x - m.pos.x) * (other.pos.x - m.pos.x) + (g.z - m.pos.z) * (other.pos.z - m.pos.z) > 0
  )
    m.goal = null
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

/**
 * Moves `b` away from `a` by `d` along (ux, uz): half each, all of it on the one awake when the
 * other sleeps, and on whichever is free when the other is against the edge.
 */
function pushApart(
  pa: Vec3,
  pb: Vec3,
  ux: number,
  uz: number,
  d: number,
  sa: boolean,
  sb: boolean,
  clamp?: Clamp,
) {
  if (sa && !sb) {
    move(pb, ux * d, uz * d, clamp)
    return
  }
  if (sb && !sa) {
    move(pa, -ux * d, -uz * d, clamp)
    return
  }
  const ax = pa.x,
    az = pa.z,
    bx = pb.x,
    bz = pb.z
  const movedA = move(pa, (-ux * d) / 2, (-uz * d) / 2, clamp),
    movedB = move(pb, (ux * d) / 2, (uz * d) / 2, clamp)
  const left = d - ((pb.x - bx - (pa.x - ax)) * ux + (pb.z - bz - (pa.z - az)) * uz)
  // One of them is against the edge, so the other takes what is left of the push
  if (left > 1e-9) {
    if (movedA >= movedB) move(pa, -ux * left, -uz * left, clamp)
    else move(pb, ux * left, uz * left, clamp)
  }
}

/**
 * Which awake puppy other than `chaser` stands nearest `at` along the floor, by its body: the
 * one in the way of a chase. −1 when all the others sleep.
 */
export function inTheWay(
  states: readonly MotionState[],
  bodies: readonly Body[],
  chaser: number,
  at: Pick<Vec3, 'x' | 'z'>,
): number {
  let best = -1,
    nearest = Infinity
  for (let i = 0; i < states.length; i++) {
    if (i === chaser || states[i]!.pose === 'sleep') continue
    for (let k = 0; k < SPHERES; k++) {
      const s = sphereAt(bodies[i]!, k),
        d = Math.hypot(at.x - s.x, at.z - s.z) - s.r
      if (d < nearest) {
        nearest = d
        best = i
      }
    }
  }
  return best
}

/**
 * Keeps everyone but `owner` out of the circle of radius `r` round (x, z), and their goals with
 * them: the scale while one puppy is weighed.
 */
export function keepOff(
  states: readonly MotionState[],
  owner: MotionState,
  x: number,
  z: number,
  r: number,
  clamp?: Clamp,
): void {
  for (const s of states) {
    if (s === owner) continue
    out(s.pos, x, z, r, clamp)
    if (s.goal) out(s.goal, x, z, r, clamp)
  }
}

function out(p: Vec3, x: number, z: number, r: number, clamp?: Clamp) {
  const dx = p.x - x,
    dz = p.z - z,
    d = Math.hypot(dx, dz)
  if (d >= r) return
  if (d > 1e-6) move(p, (dx / d) * (r - d), (dz / d) * (r - d), clamp)
  else move(p, r, 0, clamp)
}

function move(p: Vec3, dx: number, dz: number, clamp?: Clamp): number {
  const x0 = p.x,
    z0 = p.z
  p.x += dx
  p.z += dz
  if (clamp) [p.x, p.z] = clamp(p.x, p.z)
  return Math.hypot(p.x - x0, p.z - z0)
}

/** Moves `b` the whole way out of `still`'s space. */
function shove(still: Vec3, b: Vec3, minDist: number, clamp?: Clamp) {
  const dx = b.x - still.x,
    dz = b.z - still.z,
    d = Math.hypot(dx, dz)
  if (d >= minDist) return
  const [nx, nz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0]
  move(b, nx * (minDist - d), nz * (minDist - d), clamp)
}

function push(a: Vec3, b: Vec3, minDist: number, clamp?: Clamp) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    d = Math.hypot(dx, dz)
  if (d >= minDist) return
  const [nx, nz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0],
    half = (minDist - d) / 2
  const movedA = move(a, -nx * half, -nz * half, clamp),
    movedB = move(b, nx * half, nz * half, clamp)
  const left = minDist - Math.hypot(b.x - a.x, b.z - a.z)
  if (left <= 1e-9) return
  // One of them is against the edge, so the other takes what is left of the push
  const [free, s] = movedA >= movedB ? [a, -1] : [b, 1]
  move(free, s * nx * left, s * nz * left, clamp)
}

/** Chance that two puppies both go for the ball and race for it. */
const RACE = 0.3

export interface ClaimOpts {
  random: () => number
  /** Each puppy's energy, same order as the fetches. */
  energies: readonly number[]
  /** Mouth positions (the bodies when absent). */
  mouths?: readonly Vec3[]
}

/**
 * Decides who fetches a thrown ball among the chasers: a weighted random pick, favouring the
 * energetic and the near (distance from the mouth to the ball). Now and then, with two chasers,
 * both go and the first to reach it wins (returns null). The others give up, stop where they are
 * and watch the ball.
 */
export function claimBall(
  fetches: FetchState[],
  motions: MotionState[],
  ball: BallState,
  { random, energies, mouths }: ClaimOpts,
): number | null {
  if (ball.state !== 'air') return null
  const chasers: number[] = []
  for (let i = 0; i < fetches.length; i++) if (fetches[i]!.task === 'chase') chasers.push(i)
  if (chasers.length === 2 && random() < RACE) return null
  const weights = chasers.map((i) => {
    const at = mouths?.[i] ?? motions[i]!.pos,
      d = Math.hypot(at.x - ball.pos.x, at.z - ball.pos.z)
    return (energies[i] ?? 0.5) / (0.3 + d)
  })
  let roll = random() * weights.reduce((a, b) => a + b, 0),
    best: number | null = null
  for (let k = 0; k < chasers.length; k++) {
    best = chasers[k]!
    roll -= weights[k]!
    if (roll < 0) break
  }
  for (const i of chasers) {
    if (i === best) continue
    const f = fetches[i]!
    f.task = 'free'
    f.taskT = 0
    f.watch = true
    motions[i]!.goal = null
  }
  return best
}
