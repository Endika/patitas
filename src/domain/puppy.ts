import { BREEDS, type BreedId, type Persona } from './breeds'

export const MAX_NAME_GRAPHEMES = 20
const PERSONA_VARIATION = 0.15

export interface Puppy {
  id: string
  name: string
  breedId: BreedId
  persona: Persona
  adoptedAt: number
}

export class InvalidPuppyName extends Error {
  constructor() {
    super(`Puppy name must have 1 to ${MAX_NAME_GRAPHEMES} characters`)
    this.name = 'InvalidPuppyName'
  }
}

const segmenter = new Intl.Segmenter('es', { granularity: 'grapheme' })

const countGraphemes = (text: string): number => {
  let count = 0
  for (const _ of segmenter.segment(text)) count += 1
  return count
}

const vary = (base: number, random: () => number): number =>
  Math.min(1, Math.max(0, base + (random() * 2 - 1) * PERSONA_VARIATION))

export function createPuppy(input: {
  name: string
  breedId: BreedId
  now: number
  random: () => number
}): Puppy {
  const name = input.name.trim()
  const length = countGraphemes(name)
  if (length === 0 || length > MAX_NAME_GRAPHEMES) throw new InvalidPuppyName()
  const base = BREEDS[input.breedId].defaultPersona
  const energy = vary(base.energy, input.random)
  const cuddly = vary(base.cuddly, input.random)
  const curious = vary(base.curious, input.random)
  const bath = vary(base.bath, input.random)
  const social = vary(base.social, input.random)
  return {
    id: crypto.randomUUID(),
    name,
    breedId: input.breedId,
    persona: { energy, cuddly, curious, bath, social },
    adoptedAt: input.now,
  }
}

/** FNV-1a over `text`, scaled to [0, 1): the same text always gives the same number. */
function hashUnit(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0) / 4294967296
}

/**
 * A puppy adopted before it had a liking for the bath and for company gets them from its breed,
 * varied as at adoption but drawn from its id, so they come out the same until saved.
 */
export function withPersonaDefaults(puppy: Puppy): Puppy {
  const { persona } = puppy
  if (persona.bath !== undefined && persona.social !== undefined) return puppy
  const base = BREEDS[puppy.breedId].defaultPersona
  return {
    ...puppy,
    persona: {
      ...persona,
      bath: persona.bath ?? vary(base.bath, () => hashUnit(`${puppy.id}:bath`)),
      social: persona.social ?? vary(base.social, () => hashUnit(`${puppy.id}:social`)),
    },
  }
}

/** Below this a trait shows as its low word, and above 1 minus it as its high one. */
const MARKED = 0.3
const TRAIT_WORDS: [keyof Persona, string, string][] = [
  ['energy', 'Juguetón', 'Tranquilo'],
  ['cuddly', 'Mimoso', 'Independiente'],
  ['curious', 'Curioso', 'Prudente'],
  ['bath', 'Le encanta el baño', 'Odia el baño'],
  ['social', 'Sociable', 'Va a su aire'],
]

/** Its three most marked traits in words, the most marked first; none in between shows. */
export function traits(persona: Persona): string[] {
  return TRAIT_WORDS.flatMap(([key, high, low]) => {
    const v = persona[key]
    if (v > 1 - MARKED) return [{ word: high, by: v - 0.5 }]
    if (v < MARKED) return [{ word: low, by: 0.5 - v }]
    return []
  })
    .sort((a, b) => b.by - a.by)
    .slice(0, 3)
    .map((t) => t.word)
}
