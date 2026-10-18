import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'

describe('BREEDS', () => {
  it('has the three breeds with their Spanish labels', () => {
    expect(Object.keys(BREEDS).sort()).toEqual(['beagle', 'dorado', 'shiba'])
    expect(BREEDS.dorado.label).toBe('Dorado')
    expect(BREEDS.shiba.label).toBe('Shiba')
    expect(BREEDS.beagle.label).toBe('Beagle')
  })

  it('keeps every default persona trait within [0, 1]', () => {
    for (const breed of Object.values(BREEDS)) {
      for (const value of Object.values(breed.defaultPersona)) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('carries hex palettes for each coat', () => {
    for (const breed of Object.values(BREEDS)) {
      expect(Object.keys(breed.palette)).toHaveLength(3)
      for (const hex of Object.values(breed.palette)) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})
