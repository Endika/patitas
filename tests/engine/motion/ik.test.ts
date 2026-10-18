// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BREEDS } from '@/domain/breeds'
import { anatomy, type Anatomy } from '@/engine/puppy/anatomy'
import { legRigs, solveTwoBone, type LegRig } from '@/engine/motion/ik'

const A = anatomy(BREEDS.dorado)
const rigs = legRigs(A)
const CHAINS = [
  ['shL', 'elL', 'wrL'],
  ['shR', 'elR', 'wrR'],
  ['hipL', 'kneeL', 'hockL'],
  ['hipR', 'kneeR', 'hockR'],
] as const

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pos = (a: Anatomy, name: string) => new THREE.Vector3(...a.bones[a.bi[name]!]!.pos)

/** Rigid-body chain from the anatomy's rest offsets, each bone rotated about its own X axis. */
function forward(a: Anatomy, chain: readonly string[], j0: THREE.Vector3, angles: number[]) {
  const [up, mid, end] = chain.map((n) => pos(a, n))
  const m = new THREE.Matrix4().makeTranslation(j0.x, j0.y, j0.z)
  m.multiply(new THREE.Matrix4().makeRotationX(angles[0]!))
  const elbow = new THREE.Vector3().setFromMatrixPosition(m)
  const d1 = mid!.clone().sub(up!)
  m.multiply(new THREE.Matrix4().makeTranslation(d1.x, d1.y, d1.z))
  m.multiply(new THREE.Matrix4().makeRotationX(angles[1]!))
  const d2 = end!.clone().sub(mid!)
  m.multiply(new THREE.Matrix4().makeTranslation(d2.x, d2.y, d2.z))
  return { root: elbow, end: new THREE.Vector3().setFromMatrixPosition(m) }
}

describe('legRigs', () => {
  it('builds [LF, RF, LH, RH] with the prototype bend and flex', () => {
    expect(rigs.map((r) => [r.bend, r.flex])).toEqual([
      [-1, 0.8],
      [-1, 0.8],
      [1, 0.5],
      [1, 0.5],
    ])
  })
})

describe.each([
  ['front', 0],
  ['hind', 2],
])('solveTwoBone (%s leg)', (_label, i) => {
  const rig: LegRig = rigs[i]!
  const chain = CHAINS[i]!
  const endX = pos(A, chain[2]).x - pos(A, chain[0]).x + rig.j0.x

  it('reaches 50 random reachable targets within 1 mm', () => {
    const rnd = mulberry32(1234 + i)
    const lo = Math.abs(rig.l1 - rig.l2) + 0.01
    const hi = rig.l1 + rig.l2 - 0.01
    for (let n = 0; n < 50; n++) {
      const d = lo + (hi - lo) * rnd()
      const phi = (rnd() - 0.5) * 2.4
      const target = new THREE.Vector3(
        endX,
        rig.j0.y - Math.cos(phi) * d,
        rig.j0.z + Math.sin(phi) * d,
      )
      const angles = solveTwoBone(rig, target, (rnd() - 0.5) * 0.5, rnd())
      expect(angles.every(Number.isFinite)).toBe(true)
      expect(forward(A, chain, rig.j0, angles).end.distanceTo(target)).toBeLessThan(1e-3)
    }
  })

  it('leaves the leg stretched towards an unreachable target without NaN', () => {
    const far = new THREE.Vector3(endX, rig.j0.y - 2, rig.j0.z + 1)
    const angles = solveTwoBone(rig, far, 0, 0)
    expect(angles.every(Number.isFinite)).toBe(true)
    const { end } = forward(A, chain, rig.j0, angles)
    const reach = end.clone().sub(rig.j0)
    const want = far.clone().sub(rig.j0)
    reach.x = want.x = 0
    expect(reach.length()).toBeGreaterThan(0.99 * (rig.l1 + rig.l2))
    expect(reach.angleTo(want)).toBeLessThan(0.05)
  })

  it('stays finite with the target on the joint itself', () => {
    expect(solveTwoBone(rig, rig.j0.clone(), 0, 0).every(Number.isFinite)).toBe(true)
  })
})
