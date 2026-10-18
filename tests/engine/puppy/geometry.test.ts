// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import { BREEDS, type BreedId } from '@/domain/breeds'
import { buildPuppyGeometry } from '@/engine/puppy/geometry'
import type { Anatomy } from '@/engine/puppy/anatomy'
import { field } from '@/engine/puppy/sdf'

type Built = { geometry: THREE.BufferGeometry; anatomy: Anatomy }
const ids = Object.keys(BREEDS) as BreedId[]
const built = {} as Record<BreedId, Built>

beforeAll(() => {
  for (const id of ids) built[id] = buildPuppyGeometry(BREEDS[id])
}, 120_000)

const attr = (g: THREE.BufferGeometry, name: string) => g.getAttribute(name).array

describe.each(ids)('buildPuppyGeometry(%s)', (id) => {
  it('has finite positions and unit normals', () => {
    const { geometry } = built[id]
    const position = attr(geometry, 'position')
    const normal = attr(geometry, 'normal')
    expect(position.every(Number.isFinite)).toBe(true)
    expect(normal.every(Number.isFinite)).toBe(true)
    for (let q = 0; q < normal.length; q += 3) {
      const len = Math.hypot(normal[q]!, normal[q + 1]!, normal[q + 2]!)
      expect(Math.abs(len - 1)).toBeLessThan(1e-3)
    }
  })

  it('has normalised skin weights pointing at real bones', () => {
    const { geometry, anatomy } = built[id]
    const weight = attr(geometry, 'skinWeight')
    const index = attr(geometry, 'skinIndex')
    for (let q = 0; q < weight.length; q += 4) {
      const sum = weight[q]! + weight[q + 1]! + weight[q + 2]! + weight[q + 3]!
      expect(Math.abs(sum - 1)).toBeLessThan(1e-5)
    }
    expect(index.every((b) => b < anatomy.bones.length)).toBe(true)
  })

  it('has no fur right around the eyes', () => {
    const { geometry, anatomy } = built[id]
    const position = attr(geometry, 'position')
    const furLen = attr(geometry, 'furLen')
    for (let q = 0; q < furLen.length; q++) {
      const x = position[q * 3]!
      const y = position[q * 3 + 1]!
      const z = position[q * 3 + 2]!
      for (const [ex, ey, ez] of anatomy.eyes) {
        if (Math.hypot(x - ex, y - ey, z - ez) < anatomy.eyeR * 1.2) expect(furLen[q]).toBe(0)
      }
    }
  })

  it('stays within the vertex budget', () => {
    const count = built[id].geometry.getAttribute('position').count
    expect(count).toBeGreaterThanOrEqual(6000)
    expect(count).toBeLessThanOrEqual(40000)
  })
})

describe('shiba tail', () => {
  it('keeps the shiba curl as a roll above the back', () => {
    const { geometry, anatomy } = built.shiba
    const position = attr(geometry, 'position')
    const index = attr(geometry, 'skinIndex')
    const weight = attr(geometry, 'skinWeight')
    const curl = new Set([anatomy.bi.tail1, anatomy.bi.tail2])
    const body = anatomy.prims.filter((p) => p.tag !== 'tail' && p.tag !== 'tailtip')
    let checked = 0
    let closest = Infinity
    for (let q = 0; q < geometry.getAttribute('position').count; q++) {
      let best = 0
      for (let s = 1; s < 4; s++) if (weight[q * 4 + s]! > weight[q * 4 + best]!) best = s
      if (!curl.has(index[q * 4 + best]!) || weight[q * 4 + best]! < 0.7) continue
      checked++
      const d = field(body, position[q * 3]!, position[q * 3 + 1]!, position[q * 3 + 2]!)
      closest = Math.min(closest, d)
    }
    expect(checked).toBeGreaterThan(0)
    expect(closest).toBeGreaterThanOrEqual(0.01)
  })
})
