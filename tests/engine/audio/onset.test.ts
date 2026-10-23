import { describe, expect, it } from 'vitest'
import { createEars, hearLevel, levelOf } from '@/engine/audio/onset'

const STEP = 0.02

/**
 * What the ears make of `seconds` of a room at `background` dBFS with a knock `loud` dB over it,
 * lasting 0.1 s, at each time in `knocks`.
 */
function listen(seconds: number, background: number, knocks: number[], loud = 25) {
  const ears = createEars()
  const heard: { at: number; kind: 'noise' | 'call' }[] = []
  for (let n = 0; n * STEP < seconds; n++) {
    const t = n * STEP
    const knocking = knocks.some((k) => t >= k && t < k + 0.1)
    const kind = hearLevel(ears, knocking ? background + loud : background, STEP)
    if (kind) heard.push({ at: Math.round(t * 100) / 100, kind })
  }
  return heard
}

describe('hearLevel', () => {
  it('hears nothing in a steady sound, however loud', () => {
    expect(listen(30, -60, [])).toEqual([])
    expect(listen(30, -15, [])).toEqual([])
  })

  it('hears a clap over a quiet room and over a noisy one', () => {
    expect(listen(3, -65, [1]).map((h) => h.kind)).toEqual(['noise'])
    expect(listen(3, -30, [1]).map((h) => h.kind)).toEqual(['noise'])
  })

  it('does not count a sound that hardly rises over the background, nor one too faint', () => {
    expect(listen(3, -40, [1], 8)).toEqual([])
    expect(listen(3, -90, [1], 30)).toEqual([])
  })

  it('counts two knocks closer than the gap as one', () => {
    expect(listen(3, -60, [1, 1.15])).toHaveLength(1)
  })

  it('makes a call of the third knock within 4 s, and starts counting again', () => {
    expect(listen(6, -60, [1, 1.8, 2.6]).map((h) => h.kind)).toEqual(['noise', 'noise', 'call'])
    expect(listen(8, -60, [1, 1.8, 2.6, 3.4]).map((h) => h.kind)).toEqual([
      'noise',
      'noise',
      'call',
      'noise',
    ])
  })

  it('makes no call of three knocks spread over more than 4 s', () => {
    expect(listen(10, -60, [1, 3.5, 6]).map((h) => h.kind)).toEqual(['noise', 'noise', 'noise'])
  })

  it('gets used to a television switched on, and hears a clap over it', () => {
    const ears = createEars()
    for (let t = 0; t < 2; t += STEP) hearLevel(ears, -65, STEP)
    let heard = 0
    // The television comes on, 25 dB louder, and stays on
    for (let t = 0; t < 120; t += STEP) if (hearLevel(ears, -40, STEP)) heard++
    expect(heard).toBe(1)
    expect(hearLevel(ears, -15, STEP)).toBe('noise')
  })
})

describe('levelOf', () => {
  it('gives a full-scale square wave 0 dB and silence the bottom of the scale', () => {
    expect(levelOf([1, -1, 1, -1])).toBeCloseTo(0)
    expect(levelOf([0.1, -0.1])).toBeCloseTo(-20)
    expect(levelOf(new Float32Array(64))).toBe(-120)
  })
})
