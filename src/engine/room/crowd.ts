import type { Vec3 } from '@/engine/math'
import type { FetchState } from '@/engine/motion/fetch'
import type { MotionState } from '@/engine/motion/locomotion'
import type { BallState } from './ball'

/**
 * Keeps puppies from standing inside each other: overlapping bodies are pushed apart evenly,
 * and two walking to the same spot get spots `minDist` apart. A walker heading where another
 * stands keeps its goal and nudges that one aside, so a chase can always reach the ball.
 */
export function separate(
  states: MotionState[],
  minDist = 0.45,
  clamp?: (x: number, z: number) => [number, number],
): void {
  for (let i = 0; i < states.length; i++)
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i]!,
        b = states[j]!
      push(a.pos, b.pos, minDist, 0.5, 0.5)
      if (a.goal && b.goal) {
        push(a.goal, b.goal, minDist, 0.5, 0.5)
        if (clamp) for (const g of [a.goal, b.goal]) [g.x, g.z] = clamp(g.x, g.z)
      }
    }
}

function push(a: Vec3, b: Vec3, minDist: number, wa: number, wb: number) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    d = Math.hypot(dx, dz)
  if (d >= minDist) return
  const [nx, nz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0],
    gap = minDist - d
  a.x -= nx * gap * wa
  a.z -= nz * gap * wa
  b.x += nx * gap * wb
  b.z += nz * gap * wb
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
