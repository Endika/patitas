import { dirtRest, type DirtRest } from '@/engine/puppy/dirt'

const NOSE = [0, 0.68, 0.58] as const

export type Part = 'paw' | 'belly' | 'back' | 'flank' | 'muzzle'

/** A stand-in puppy: rows of vertices on its paws, belly, back, flanks and the tip of its muzzle. */
export function standIn(): { rest: DirtRest; parts: Part[]; position: Float32Array } {
  const pos: number[] = [],
    nrm: number[] = [],
    parts: Part[] = []
  const add = (part: Part, x: number, y: number, z: number, n: [number, number, number]) => {
    pos.push(x, y, z)
    nrm.push(...n)
    parts.push(part)
  }
  for (let i = 0; i < 40; i++) {
    const s = i / 39
    add('paw', -0.15 + 0.3 * s, 0.02 + 0.099 * s, i % 2 ? 0.3 : -0.3, [0, -0.2, 0.98])
    add('belly', -0.1 + 0.2 * s, 0.24, -0.25 + 0.5 * s, [0, -1, 0])
    add('back', -0.1 + 0.2 * s, 0.5, -0.3 + 0.6 * s, [0, 1, 0])
    add('flank', i % 2 ? 0.12 : -0.12, 0.4, -0.3 + 0.6 * s, [i % 2 ? 1 : -1, 0, 0])
    add('muzzle', -0.03 + 0.06 * s, 0.66 + 0.02 * s, 0.6, [0, 0, 1])
  }
  const position = new Float32Array(pos)
  return { rest: dirtRest(position, new Float32Array(nrm), NOSE), parts, position }
}

export const meanOf = (field: Float32Array, parts: Part[], part: Part) => {
  let s = 0,
    n = 0
  parts.forEach((p, i) => {
    if (p !== part) return
    s += field[i]!
    n++
  })
  return s / n
}
