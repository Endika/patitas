// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { buildPuppyGeometry } from '@/engine/puppy/geometry'
import { loadPuppyGeometry, peekPuppyGeometry } from '@/engine/puppy/geometryClient'

describe('loadPuppyGeometry without Worker', () => {
  it('builds on the main thread, once per breed', async () => {
    expect(typeof Worker).toBe('undefined')
    expect(peekPuppyGeometry('beagle')).toBeUndefined()

    const first = loadPuppyGeometry('beagle')
    expect(loadPuppyGeometry('beagle')).toBe(first)
    const loaded = await first
    expect(peekPuppyGeometry('beagle')).toBe(loaded)

    const built = buildPuppyGeometry(BREEDS.beagle)
    for (const [name, attr] of Object.entries(built.geometry.attributes))
      expect(loaded.geometry.getAttribute(name).array, name).toEqual(attr.array)
    expect(loaded.geometry.getIndex()!.array).toEqual(built.geometry.getIndex()!.array)
    expect(loaded.anatomy).toEqual(built.anatomy)
  }, 30_000)
})
