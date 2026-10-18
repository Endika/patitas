// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { field, smin, type Prim } from '@/engine/puppy/sdf'

const unitSphere: Prim = { t: 0, cx: 0, cy: 0, cz: 0, r: 1, b: 0, k: 0, tag: 'body', sub: false }

describe('sdf', () => {
  it('smin with zero blend is a plain min', () => {
    expect(smin(1, 2, 0)).toBe(1)
  })

  it('field of a unit sphere is -1 at its centre and 0 on its surface', () => {
    expect(field([unitSphere], 0, 0, 0)).toBeCloseTo(-1, 9)
    expect(field([unitSphere], 1, 0, 0)).toBeCloseTo(0, 9)
  })
})
