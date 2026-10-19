import type { Vec3 } from '@/engine/math'
import type { FetchState } from '@/engine/motion/fetch'
import type { MotionState } from '@/engine/motion/locomotion'
import { keepApart, type ClampTo, type ScaleClear } from './apart'
import type { BallState } from './ball'
import { sphereAt, SPHERES, type Body } from './bodies'

/** Two walking to the same spot get spots this far apart. */
const GOAL_SPACE = 0.45

/**
 * Keeps puppies from standing inside each other: their bodies (one per state, in the same order,
 * moved along with each push) part until no sphere of one is in a sphere of another, a little at
 * a time (see `keepApart`), and two walking to the same spot get spots GOAL_SPACE apart. With
 * `clamp`, bodies and goals stay in the play area. A sleeper and those `fixed` (busy in their
 * place) stay put and the other takes the whole push. `dt` lets a turn into another be taken
 * back. While one is weighed, `scale` keeps the others and their goals out of its circle, within
 * the same step a frame: so weighing starting never jumps one.
 */
export function separate(
  states: readonly MotionState[],
  bodies: readonly Body[],
  clamp?: ClampTo,
  fixed: readonly boolean[] | null = null,
  dt = 0,
  scale: ScaleClear | null = null,
): void {
  keepApart(states, bodies, clamp, fixed, dt, scale)
  for (let i = 0; i < states.length; i++)
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i]!.goal,
        b = states[j]!.goal
      if (a && b) spread(a, b, clamp)
    }
}

/** Moves two goals apart evenly until GOAL_SPACE apart; one held by the edge leaves the rest to the other. */
function spread(a: Vec3, b: Vec3, clamp?: ClampTo) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    d = Math.hypot(dx, dz)
  if (d >= GOAL_SPACE) return
  const nx = d > 1e-6 ? dx / d : 1,
    nz = d > 1e-6 ? dz / d : 0,
    half = (GOAL_SPACE - d) / 2
  const movedA = move(a, -nx * half, -nz * half, clamp),
    movedB = move(b, nx * half, nz * half, clamp)
  const left = GOAL_SPACE - Math.hypot(b.x - a.x, b.z - a.z)
  if (left <= 1e-9) return
  if (movedA >= movedB) move(a, -nx * left, -nz * left, clamp)
  else move(b, nx * left, nz * left, clamp)
}

function move(p: Vec3, dx: number, dz: number, clamp?: ClampTo): number {
  const x0 = p.x,
    z0 = p.z
  p.x += dx
  p.z += dz
  clamp?.(p)
  return Math.hypot(p.x - x0, p.z - z0)
}

/** How far to each side of the line from a chaser to the ball a body still stands in the way. */
const CORRIDOR = 0.2

/**
 * The puppy standing in the way of `chaser`'s chase for the ball at `at`: of those `free` to step
 * aside, the one with a sphere in the corridor from the chaser to the ball, nearest the ball.
 * −1 when nobody free is in the way.
 */
export function inTheWay(
  states: readonly MotionState[],
  bodies: readonly Body[],
  free: readonly boolean[],
  chaser: number,
  at: Pick<Vec3, 'x' | 'z'>,
): number {
  const c = states[chaser]!.pos,
    lx = at.x - c.x,
    lz = at.z - c.z,
    l2 = lx * lx + lz * lz
  let best = -1,
    nearest = Infinity
  for (let i = 0; i < states.length; i++) {
    if (i === chaser || !free[i]) continue
    for (let k = 0; k < SPHERES; k++) {
      const s = sphereAt(bodies[i]!, k),
        u = l2 > 1e-12 ? Math.max(0, Math.min(1, ((s.x - c.x) * lx + (s.z - c.z) * lz) / l2)) : 1,
        off = Math.hypot(s.x - c.x - u * lx, s.z - c.z - u * lz) - s.r
      if (off > CORRIDOR) continue
      const d = Math.hypot(at.x - s.x, at.z - s.z) - s.r
      if (d < nearest) {
        nearest = d
        best = i
      }
    }
  }
  return best
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
