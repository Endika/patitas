// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { anatomy } from '@/engine/puppy/anatomy'

describe('anatomy zones', () => {
  it.each(Object.values(BREEDS))('names the $id caress zones in English', (breed) => {
    const ids = new Set(anatomy(breed).zones.map((z) => z.zone))
    expect([...ids].sort()).toEqual(['back', 'belly', 'chest', 'ears', 'head', 'muzzle'])
  })
})
