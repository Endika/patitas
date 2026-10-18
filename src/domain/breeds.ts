export type BreedId = 'dorado' | 'shiba' | 'beagle'
export type CoatId = 'dorado' | 'shiba' | 'beagle'

export interface Persona {
  energy: number
  cuddly: number
  curious: number
}

export interface BreedShape {
  leg: number
  body: number
  head: number
  snout: number
  snoutW: number
  ear: 'floppy' | 'erect'
  earLen: number
  earW: number
  tail: 'flag' | 'curl'
  tailLen: number
  eye: number
}

export interface FurParams {
  fur: number
  density: number
  comb: number
  droop: number
}

export interface Breed {
  id: BreedId
  label: string
  defaultPersona: Persona
  shape: BreedShape
  coat: CoatId
  palette: Record<string, string>
  fur: FurParams
  nose: string
  iris: [string, string]
  weightKg: { min: number; max: number }
}

export const BREEDS: Record<BreedId, Breed> = {
  dorado: {
    id: 'dorado',
    label: 'Dorado',
    defaultPersona: { energy: 0.45, cuddly: 0.9, curious: 0.4 },
    shape: {
      leg: 1,
      body: 1.06,
      head: 1,
      snout: 0.95,
      snoutW: 1.05,
      ear: 'floppy',
      earLen: 0.2,
      earW: 1,
      tail: 'flag',
      tailLen: 1,
      eye: 1.05,
    },
    coat: 'dorado',
    palette: { base: '#cf9654', light: '#eccf9f', dark: '#a9713a' },
    fur: { fur: 0.032, density: 240, comb: 0.35, droop: 0.5 },
    nose: '#2b1f1a',
    iris: ['#6e401e', '#2a160a'],
    weightKg: { min: 9, max: 13 },
  },
  shiba: {
    id: 'shiba',
    label: 'Shiba',
    defaultPersona: { energy: 0.55, cuddly: 0.3, curious: 0.9 },
    shape: {
      leg: 1.02,
      body: 1,
      head: 1,
      snout: 0.85,
      snoutW: 0.92,
      ear: 'erect',
      earLen: 0.115,
      earW: 1,
      tail: 'curl',
      tailLen: 1,
      eye: 0.95,
    },
    coat: 'shiba',
    palette: { red: '#c4622a', cream: '#f3e4cd', sesame: '#7a3f1d' },
    fur: { fur: 0.038, density: 230, comb: 0.15, droop: 0.2 },
    nose: '#1d1714',
    iris: ['#5a3216', '#1e1007'],
    weightKg: { min: 3.5, max: 5 },
  },
  beagle: {
    id: 'beagle',
    label: 'Beagle',
    defaultPersona: { energy: 1, cuddly: 0.6, curious: 0.6 },
    shape: {
      leg: 0.92,
      body: 1.02,
      head: 1.02,
      snout: 1.1,
      snoutW: 1.05,
      ear: 'floppy',
      earLen: 0.27,
      earW: 1.2,
      tail: 'flag',
      tailLen: 1.15,
      eye: 1.1,
    },
    coat: 'beagle',
    palette: { tan: '#b4692b', black: '#2a211b', white: '#f0eae0' },
    fur: { fur: 0.016, density: 320, comb: 0.6, droop: 0.25 },
    nose: '#1c1512',
    iris: ['#7a4a22', '#2e1a0c'],
    weightKg: { min: 4, max: 6.5 },
  },
}
