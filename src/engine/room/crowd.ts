import type { Vec3 } from '@/engine/math'
import type { FetchState } from '@/engine/motion/fetch'
import type { MotionState } from '@/engine/motion/locomotion'
import type { BallState } from './ball'

type Clamp = (x: number, z: number) => [number, number]

/**
 * Keeps puppies from standing inside each other: overlapping bodies are pushed apart evenly,
 * and two walking to the same spot get spots `minDist` apart. A walker heading where another
 * stands keeps its goal and nudges that one aside, so a chase can always reach the ball. With
 * `clamp`, bodies and goals stay in the play area: a puppy pinned against its edge is only
 * moved along it, and the other one takes the rest of the push. A sleeper stays in its place in
 * the bed and the awake one takes the whole push.
 */
export function separate(states: MotionState[], minDist = 0.45, clamp?: Clamp): void {
  for (let i = 0; i < states.length; i++)
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i]!,
        b = states[j]!
      const sa = a.pose === 'sleep',
        sb = b.pose === 'sleep'
      if (sa !== sb) shove(sa ? a.pos : b.pos, sa ? b.pos : a.pos, minDist, clamp)
      else push(a.pos, b.pos, minDist, clamp)
      if (a.goal && b.goal) push(a.goal, b.goal, minDist, clamp)
    }
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
