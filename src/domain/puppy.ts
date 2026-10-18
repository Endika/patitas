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
  return {
    id: crypto.randomUUID(),
    name,
    breedId: input.breedId,
    persona: { energy, cuddly, curious },
    adoptedAt: input.now,
  }
}
