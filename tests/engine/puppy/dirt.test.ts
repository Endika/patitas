// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { addMess, createCare, messPenalty } from '@/domain/care'
import {
  brushAt,
  createDirt,
  createDirtField,
  DIRT_STEP,
  dirtRest,
  meanDirt,
  messDepth,
  redistributeDirt,
  scrubAt,
  soilFromMud,
  stepDirt,
  withDirt,
  type DirtRest,
} from '@/engine/puppy/dirt'

const NOSE = [0, 0.68, 0.58] as const

type Part = 'paw' | 'belly' | 'back' | 'muzzle'

/** A stand-in puppy: rows of vertices on its paws, belly, back and the tip of its muzzle. */
function body(): { rest: DirtRest; parts: Part[]; position: Float32Array } {
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
    add('muzzle', -0.03 + 0.06 * s, 0.66 + 0.02 * s, 0.6, [0, 0, 1])
  }
  const position = new Float32Array(pos)
  return { rest: dirtRest(position, new Float32Array(nrm), NOSE), parts, position }
}

const meanOf = (field: Float32Array, parts: Part[], part: Part) => {
  let s = 0,
    n = 0
  parts.forEach((p, i) => {
    if (p !== part) return
    s += field[i]!
    n++
  })
  return s / n
}

/** Stands `secs` in mud `depth` deep, soiled the way the room does it. */
const wade = (field: Float32Array, rest: DirtRest, depth: number, secs: number) => {
  for (let t = 0; t < secs - 1e-9; t += DIRT_STEP) soilFromMud(field, rest, depth, DIRT_STEP)
}

describe('dirt', () => {
  it('starts clean, one value per vertex', () => {
    const f = createDirtField(7)
    expect(f).toBeInstanceOf(Float32Array)
    expect([...f]).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(meanDirt(f)).toBe(0)
  })

  it('3 s in the puddle soils the paws much more than the back', () => {
    const { rest, parts } = body()
    const f = createDirtField(parts.length)
    wade(f, rest, 1, 3)
    expect(meanOf(f, parts, 'paw')).toBeGreaterThan(0.7)
    expect(meanOf(f, parts, 'back')).toBe(0)
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('soils paws first, then the belly, then the tip of the muzzle, deeper and longer', () => {
    const { rest, parts } = body()
    const at = (depth: number, secs: number) => {
      const f = createDirtField(parts.length)
      wade(f, rest, depth, secs)
      return { f, of: (p: Part) => meanOf(f, parts, p) }
    }
    const edge = at(0.2, 3)
    expect(edge.of('paw')).toBeGreaterThan(0.2)
    expect([edge.of('belly'), edge.of('muzzle')]).toEqual([0, 0])
    const middle = at(0.55, 3)
    expect(middle.of('belly')).toBeGreaterThan(0)
    expect(middle.of('muzzle')).toBe(0)
    const deep = at(1, 3)
    expect(deep.of('paw')).toBeGreaterThan(deep.of('belly'))
    expect(deep.of('belly')).toBeGreaterThan(deep.of('muzzle'))
    expect(deep.of('muzzle')).toBeGreaterThan(0)
    const long = at(1, 20)
    expect(long.of('belly')).toBeGreaterThan(deep.of('belly'))
    expect(long.of('muzzle')).toBeGreaterThan(deep.of('muzzle'))
    expect(long.of('back')).toBe(0)
  })

  it('says whether anything changed, and nothing changes out of the mud', () => {
    const { rest, parts } = body()
    const f = createDirtField(parts.length)
    expect(soilFromMud(f, rest, 0, 1)).toBe(false)
    expect(soilFromMud(f, rest, 1, 0.1)).toBe(true)
  })

  it('scrubAt cleans only inside its radius, most at the middle', () => {
    const { rest, parts, position } = body()
    const f = createDirtField(parts.length).fill(1)
    const point = { x: 0, y: 0.5, z: 0 }
    expect(scrubAt(f, rest, point, 0.1, 0.5)).toBe(true)
    let inside = 0
    parts.forEach((_, i) => {
      const d = Math.hypot(
        position[i * 3]! - point.x,
        position[i * 3 + 1]! - point.y,
        position[i * 3 + 2]! - point.z,
      )
      if (d >= 0.1) expect(f[i]).toBe(1)
      else {
        inside++
        expect(f[i]).toBeLessThan(1)
        if (d < 0.02) expect(f[i]).toBeLessThan(0.6)
      }
    })
    expect(inside).toBeGreaterThan(3)
    expect(scrubAt(f, rest, { x: 3, y: 3, z: 3 }, 0.1, 0.5)).toBe(false)
  })

  it('brushAt takes off some dry dirt in its radius, less than scrubbing', () => {
    const { rest, parts } = body()
    const scrubbed = createDirtField(parts.length).fill(1),
      brushed = createDirtField(parts.length).fill(1)
    const point = { x: 0, y: 0.5, z: 0 }
    scrubAt(scrubbed, rest, point, 0.1, 0.5)
    brushAt(brushed, rest, point, 0.1, 0.5)
    expect(meanDirt(brushed)).toBeLessThan(1)
    expect(meanDirt(brushed)).toBeGreaterThan(meanDirt(scrubbed))
    parts.forEach((_, i) => {
      if (scrubbed[i] === 1) expect(brushed[i]).toBe(1)
    })
  })

  it('cleanliness is 1 − mean dirt, and stays so through saving the level and loading it', () => {
    const { rest, parts } = body()
    const f = createDirtField(parts.length)
    wade(f, rest, 1, 6)
    const care = withDirt(createCare(BREEDS.shiba, 0), f)
    expect(care.cleanliness).toBeCloseTo(1 - meanDirt(f), 6)
    expect(care.cleanliness).toBeLessThan(1)

    const saved = JSON.parse(JSON.stringify(care)) as typeof care
    const loaded = createDirtField(parts.length)
    redistributeDirt(loaded, rest, 1 - saved.cleanliness)
    expect(meanDirt(loaded)).toBeCloseTo(meanDirt(f), 3)
    expect(withDirt(saved, loaded).cleanliness).toBeCloseTo(saved.cleanliness, 3)
    // Spread by height: the paws carry it before the back
    expect(meanOf(loaded, parts, 'paw')).toBeGreaterThan(meanOf(loaded, parts, 'back'))
  })

  it('a loaded level settles on the paws, then the belly, then the muzzle, then the back', () => {
    const { rest, parts } = body()
    const at = (level: number) => {
      const f = createDirtField(parts.length)
      redistributeDirt(f, rest, level)
      return (p: Part) => meanOf(f, parts, p)
    }
    const some = at(0.3)
    expect(some('paw')).toBeGreaterThan(some('belly'))
    expect(some('belly')).toBeGreaterThan(some('muzzle'))
    expect(some('back')).toBe(0)
    const more = at(0.6)
    expect(more('belly')).toBeGreaterThan(more('muzzle'))
    expect(more('muzzle')).toBeGreaterThan(more('back'))
  })

  it('redistributeDirt keeps any level, from clean to all mud', () => {
    const { rest, parts } = body()
    for (const level of [0, 0.05, 0.3, 0.55, 0.9, 1]) {
      const f = createDirtField(parts.length)
      redistributeDirt(f, rest, level)
      expect(meanDirt(f)).toBeCloseTo(level, 3)
    }
  })

  it('stepDirt soils at most 10 times a second, and only in the mud', () => {
    const { rest, parts } = body()
    const d = createDirt(rest)
    expect(d.field.length).toBe(parts.length)
    let changes = 0
    for (let n = 0; n < 60; n++) if (stepDirt(d, 1, 1 / 60)) changes++
    expect(changes).toBeGreaterThan(0)
    expect(changes).toBeLessThanOrEqual(10)
    const before = meanDirt(d.field)
    for (let n = 0; n < 60; n++) expect(stepDirt(d, 0, 1 / 60)).toBe(false)
    expect(meanDirt(d.field)).toBe(before)
  })

  it('a mess underfoot soils the paws only, through the same steps as mud', () => {
    const legs = [{ pos: { x: 0.5, z: 0 } }, { pos: { x: 1.02, z: 1 } }]
    const under = [{ x: 1, z: 1, r: 0.05 }]
    expect(messDepth(under, legs)).toBeGreaterThan(0)
    expect(messDepth(under, [{ pos: { x: 1.1, z: 1 } }])).toBe(0)
    expect(messDepth([], legs)).toBe(0)
    const { rest, parts } = body()
    const d = createDirt(rest)
    for (let t = 0; t < 3; t += 1 / 60) stepDirt(d, messDepth(under, legs), 1 / 60)
    expect(meanOf(d.field, parts, 'paw')).toBeGreaterThan(0.3)
    expect(meanOf(d.field, parts, 'belly')).toBe(0)
    expect(meanOf(d.field, parts, 'muzzle')).toBe(0)
  })

  it('cleanliness keeps what the waiting messes take off, through saving and loading', () => {
    const { rest } = body()
    const f = createDirtField(rest.paw.length)
    wade(f, rest, 0.5, 2)
    const messy = addMess(createCare(BREEDS.shiba, 0), { kind: 'pee', x: 0, z: 0, createdAt: 0 })
    const care = withDirt(messy, f)
    expect(care.cleanliness).toBeCloseTo(1 - meanDirt(f) - messPenalty(messy))
    const loaded = createDirtField(rest.paw.length)
    redistributeDirt(loaded, rest, 1 - care.cleanliness - messPenalty(care))
    expect(withDirt(care, loaded).cleanliness).toBeCloseTo(care.cleanliness, 3)
  })
})
