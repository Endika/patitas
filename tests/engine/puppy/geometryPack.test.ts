// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { buildPuppyGeometry } from '@/engine/puppy/geometry'
import { packPuppyGeometry, unpackPuppyGeometry } from '@/engine/puppy/geometryPack'

const ATTRIBUTES = ['position', 'normal', 'color', 'furLen', 'skinIndex', 'skinWeight']

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let d = 0
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!))
  return d
}

describe('packPuppyGeometry', () => {
  it('survives a transferring structured clone unchanged', () => {
    const built = buildPuppyGeometry(BREEDS.shiba)
    const before = Object.fromEntries(
      ATTRIBUTES.map((n) => {
        const a = built.geometry.getAttribute(n)
        return [
          n,
          {
            array: a.array.slice(),
            itemSize: a.itemSize,
            normalized: a.normalized,
            ctor: a.array.constructor,
          },
        ]
      }),
    )
    const index = built.geometry.getIndex()!.array.slice()
    const anatomy = { ...built.anatomy, lidColor: built.anatomy.lidColor.getHex() }

    const { packed, transfer } = packPuppyGeometry(built)
    const back = unpackPuppyGeometry(structuredClone(packed, { transfer }))

    for (const n of ATTRIBUTES) {
      const a = back.geometry.getAttribute(n)
      expect(a.itemSize, n).toBe(before[n]!.itemSize)
      expect(a.normalized, n).toBe(before[n]!.normalized)
      expect(a.array.constructor, n).toBe(before[n]!.ctor)
      expect(a.array.length, n).toBe(before[n]!.array.length)
      expect(maxDiff(a.array, before[n]!.array), n).toBe(0)
    }
    const backIndex = back.geometry.getIndex()!.array
    expect(backIndex.constructor).toBe(index.constructor)
    expect(backIndex.length).toBe(index.length)
    expect(maxDiff(backIndex, index)).toBe(0)

    const { lidColor, ...rest } = back.anatomy
    expect(lidColor.isColor).toBe(true)
    expect(lidColor.getHex()).toBe(anatomy.lidColor)
    const { lidColor: _, ...restBefore } = anatomy
    expect(rest).toEqual(restBefore)
  }, 30_000)
})
