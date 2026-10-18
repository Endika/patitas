import type * as THREE from 'three'

export type Vec3 = THREE.Vector3

/** Frame-rate independent exponential approach of `a` towards `b` at rate `l` per second. */
export const damp = (a: number, b: number, l: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-l * dt))

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Longest step the motion code integrates in one go. */
export const MAX_DT = 1 / 30
