import * as THREE from 'three'
import type { Anatomy, Tuple3 } from '@/engine/puppy/anatomy'
import { clamp, type Vec3 } from '@/engine/math'

/** The fixed part of a leg, measured once from the anatomy. */
export interface LegRig {
  bend: 1 | -1
  /** How much the paw curls while it is in the air. */
  flex: number
  l1: number
  l2: number
  /** Rest angles of the upper and middle bones, as atan2(dz, -dy). */
  r1: number
  r2: number
  /** Upper joint in its parent bone's frame. */
  j0: Vec3
  /** Rest position of the paw joint in the puppy's frame. */
  rest: Vec3
}

const LEGS: [string, string, string, 1 | -1, number][] = [
  ['shL', 'elL', 'wrL', -1, 0.8],
  ['shR', 'elR', 'wrR', -1, 0.8],
  ['hipL', 'kneeL', 'hockL', 1, 0.5],
  ['hipR', 'kneeR', 'hockR', 1, 0.5],
]

const ang = (p: Tuple3, q: Tuple3) => Math.atan2(q[2] - p[2], -(q[1] - p[1]))

/** Leg rigs in the order [LF, RF, LH, RH]. */
export function legRigs(a: Anatomy): LegRig[] {
  const bone = (n: string) => {
    const b = a.bones[a.bi[n] ?? -1]
    if (!b) throw new Error(`unknown bone "${n}"`)
    return b
  }
  return LEGS.map(([up, lo, end, bend, flex]) => {
    const u = bone(up),
      j0 = u.pos,
      j1 = bone(lo).pos,
      j2 = bone(end).pos
    const p = u.parent ? bone(u.parent).pos : ([0, 0, 0] as Tuple3)
    return {
      bend,
      flex,
      l1: Math.hypot(j1[1] - j0[1], j1[2] - j0[2]),
      l2: Math.hypot(j2[1] - j1[1], j2[2] - j1[2]),
      r1: ang(j0, j1),
      r2: ang(j1, j2),
      j0: new THREE.Vector3(j0[0] - p[0], j0[1] - p[1], j0[2] - p[2]),
      rest: new THREE.Vector3(...j2),
    }
  })
}

/**
 * X rotations of the upper, middle and paw bones that put the paw joint on `t`
 * (in the upper bone's parent frame); `swing` is the 0..1 progress of the step in the air.
 */
export function solveTwoBone(
  L: LegRig,
  t: Vec3,
  bodyPitch: number,
  swing: number,
): [number, number, number] {
  const dy = t.y - L.j0.y,
    dz = t.z - L.j0.z
  const d = clamp(Math.hypot(dy, dz), Math.abs(L.l1 - L.l2) + 1e-3, L.l1 + L.l2 - 1e-3)
  const a = Math.acos(clamp((L.l1 * L.l1 + d * d - L.l2 * L.l2) / (2 * L.l1 * d), -1, 1))
  const p1 = Math.atan2(dz, -dy) + L.bend * a
  const ey = L.j0.y - Math.cos(p1) * L.l1,
    ez = L.j0.z + Math.sin(p1) * L.l1
  const p2 = Math.atan2(t.z - ez, -(t.y - ey))
  const th1 = -(p1 - L.r1),
    th2 = -(p2 - L.r2 - (p1 - L.r1))
  return [th1, th2, -(th1 + th2) - bodyPitch + L.flex * Math.sin(Math.PI * swing)]
}
