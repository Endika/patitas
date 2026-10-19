import type * as THREE from 'three'

export type Vec3 = THREE.Vector3

/** Frame-rate independent exponential approach of `a` towards `b` at rate `l` per second. */
export const damp = (a: number, b: number, l: number, dt: number) =>
  a + (b - a) * (1 - Math.exp(-l * dt))

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Longest step the motion code integrates in one go. */
export const MAX_DT = 1 / 30

/** A small seeded random generator (mulberry32): the same `seed` gives the same numbers. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
