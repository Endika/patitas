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

/**
 * Decides who fetches a thrown ball: the chaser whose mouth is nearest (its body when no mouths
 * are given). The others give up, stop where they are and watch the ball.
 */
export function claimBall(
  fetches: FetchState[],
  motions: MotionState[],
  ball: BallState,
  mouths?: readonly Vec3[],
): number | null {
  if (ball.state !== 'air') return null
  let best: number | null = null,
    bd = Infinity
  for (let i = 0; i < fetches.length; i++) {
    if (fetches[i]!.task !== 'chase') continue
    const at = mouths?.[i] ?? motions[i]!.pos,
      d = Math.hypot(at.x - ball.pos.x, at.z - ball.pos.z)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  for (let i = 0; i < fetches.length; i++) {
    const f = fetches[i]!
    if (i === best || f.task !== 'chase') continue
    f.task = 'free'
    f.taskT = 0
    f.watch = true
    motions[i]!.goal = null
  }
  return best
}
