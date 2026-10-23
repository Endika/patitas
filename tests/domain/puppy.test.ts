import { describe, expect, it } from 'vitest'
import type { Persona } from '@/domain/breeds'
import {
  createPuppy,
  InvalidPuppyName,
  knows,
  teach,
  traits,
  TREAT_LESSON,
  withPersonaDefaults,
} from '@/domain/puppy'

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
    expect(make('Luna', () => 0.5).persona).toEqual({
      energy: 1,
      cuddly: 0.6,
      curious: 0.6,
      bath: 0.5,
      social: 0.85,
    })
  })

  it('draws random once per trait in energy, cuddly, curious, bath, social order', () => {
    const values = [0, 1, 0.5, 0, 1]
    let i = 0
    const persona = make('Luna', () => values[i++] ?? 0).persona
    expect(persona.energy).toBeCloseTo(0.85)
    expect(persona.cuddly).toBeCloseTo(0.75)
    expect(persona.curious).toBeCloseTo(0.6)
    expect(persona.bath).toBeCloseTo(0.35)
    expect(persona.social).toBeCloseTo(1)
    expect(i).toBe(5)
  })
})

describe('withPersonaDefaults', () => {
  /** A puppy saved before it had a liking for the bath and for company. */
  const older = (id: string) => {
    const { bath: _bath, social: _social, ...persona } = make('Luna').persona
    return { ...make('Luna'), id, persona: persona as Persona }
  }

  it('gives an older puppy both near its breed, the same every time for the same puppy', () => {
    const a = withPersonaDefaults(older('a'))
    expect(withPersonaDefaults(older('a'))).toEqual(a)
    expect(Math.abs(a.persona.bath - 0.5)).toBeLessThanOrEqual(0.15)
    expect(Math.abs(a.persona.social - 0.85)).toBeLessThanOrEqual(0.15)
    expect(a.persona.energy).toBe(1)
    const others = ['b', 'c', 'd', 'e'].map((id) => withPersonaDefaults(older(id)).persona.bath)
    expect(new Set([a.persona.bath, ...others]).size).toBeGreaterThan(1)
  })

  it('fills in only the one that is missing', () => {
    const puppy = make('Luna')
    const { social: _social, ...persona } = puppy.persona
    const filled = withPersonaDefaults({ ...puppy, persona: persona as Persona })
    expect(filled.persona.bath).toBe(puppy.persona.bath)
    expect(Math.abs(filled.persona.social - 0.85)).toBeLessThanOrEqual(0.15)
  })

  it('leaves a puppy that has them as it is', () => {
    const puppy = make('Luna')
    expect(withPersonaDefaults(puppy)).toBe(puppy)
  })
})

describe('traits', () => {
  const persona = (p: Partial<Persona>): Persona => ({
    energy: 0.5,
    cuddly: 0.5,
    curious: 0.5,
    bath: 0.5,
    social: 0.5,
    ...p,
  })

  it('names only the marked traits, high or low, the most marked first', () => {
    expect(traits(persona({}))).toEqual([])
    expect(traits(persona({ energy: 0.7, bath: 0.3 }))).toEqual([])
    expect(traits(persona({ energy: 0.75, bath: 0.05, cuddly: 0.2 }))).toEqual([
      'Odia el baño',
      'Independiente',
      'Juguetón',
    ])
    expect(traits(persona({ curious: 0.9, social: 0.1 }))).toEqual(['Curioso', 'Va a su aire'])
  })

  it('names three at most', () => {
    const all = persona({ energy: 1, cuddly: 0, curious: 0.95, bath: 1, social: 0.1 })
    expect(traits(all)).toEqual(['Juguetón', 'Independiente', 'Le encanta el baño'])
  })
})

describe('teach', () => {
  const puppy = createPuppy({ name: 'Kuma', breedId: 'shiba', now: 1, random: () => 0.5 })

  it('knows no trick to begin with, and a treat after one teaches a quarter of it', () => {
    expect(knows(puppy, 'sit')).toBe(0)
    const once = teach(puppy, 'sit')
    expect(knows(once, 'sit')).toBe(TREAT_LESSON)
    expect(knows(once, 'lie')).toBe(0)
  })

  it('never knows a trick more than fully', () => {
    let p = puppy
    for (let i = 0; i < 6; i++) p = teach(p, 'belly')
    expect(knows(p, 'belly')).toBe(1)
  })
})
