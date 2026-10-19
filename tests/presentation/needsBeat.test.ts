import { needsBeat } from '@/presentation/needsBeat'
import type { CareMode } from '@/presentation/roomStage'
import { needs } from './fakeStage'

interface Pup {
  id: string
  hunger: number
  mode: CareMode | null
}

const beat = () =>
  needsBeat<Pup>(
    (p) => needs(p.id, p.id, { hunger: p.hunger, mode: p.mode }),
    (n, p) => n.id === p.id && n.mode === p.mode,
  )

describe('needsBeat', () => {
  it('tells drifting needs at most 4 times a second', () => {
    const step = beat()
    const pup: Pup = { id: 'a', hunger: 0, mode: null }
    const told = new Set()
    for (let f = 0; f < 120; f++) {
      pup.hunger += 0.001
      told.add(step([pup], 1 / 60))
    }
    expect(told.size).toBeLessThanOrEqual(9)
    expect(told.size).toBeGreaterThanOrEqual(7)
  })

  it('tells at once what the care bar follows: a mode, or a puppy coming or going', () => {
    const step = beat()
    const a: Pup = { id: 'a', hunger: 0, mode: null }
    const first = step([a], 1 / 60)
    expect(step([a], 1 / 60)).toBe(first)
    a.mode = 'bath'
    expect(step([a], 1 / 60)[0]!.mode).toBe('bath')
    const b: Pup = { id: 'b', hunger: 0, mode: null }
    expect(step([a, b], 1 / 60).map((n) => n.id)).toEqual(['a', 'b'])
    expect(step([b], 1 / 60).map((n) => n.id)).toEqual(['b'])
  })
})
