import { describe, expect, it } from 'vitest'
import { createPuppy, InvalidPuppyName } from '@/domain/puppy'

const make = (name: string, random: () => number = () => 0.5) =>
  createPuppy({ name, breedId: 'beagle', now: 1000, random })

describe('createPuppy', () => {
  it('trims the name and keeps emojis', () => {
    const puppy = make('  Luna 🐶 ')
    expect(puppy.name).toBe('Luna 🐶')
    expect(puppy.breedId).toBe('beagle')
    expect(puppy.adoptedAt).toBe(1000)
    expect(puppy.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects names of 21 graphemes and accepts 20 made of emojis', () => {
    expect(() => make('a'.repeat(21))).toThrow(InvalidPuppyName)
    expect(() => make('🐶'.repeat(21))).toThrow(InvalidPuppyName)
    expect(make('🐶'.repeat(20)).name).toBe('🐶'.repeat(20))
    expect(make('👨‍👩‍👧'.repeat(20)).name).toBe('👨‍👩‍👧'.repeat(20))
  })

  it('rejects empty and blank names', () => {
    expect(() => make('')).toThrow(InvalidPuppyName)
    expect(() => make('   ')).toThrow(InvalidPuppyName)
  })

  it('varies the breed persona by +-0.15 and clamps it', () => {
    expect(make('Luna', () => 0).persona.energy).toBeCloseTo(0.85)
    expect(make('Luna', () => 1).persona.energy).toBe(1)
    expect(make('Luna', () => 0.5).persona).toEqual({ energy: 1, cuddly: 0.6, curious: 0.6 })
  })

  it('draws random once per trait in energy, cuddly, curious order', () => {
    const values = [0, 1, 0.5]
    let i = 0
    const persona = make('Luna', () => values[i++] ?? 0).persona
    expect(persona.energy).toBeCloseTo(0.85)
    expect(persona.cuddly).toBeCloseTo(0.75)
    expect(persona.curious).toBeCloseTo(0.6)
    expect(i).toBe(3)
  })
})
