// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifyGesture, pointerMode, type Sample } from '@/engine/room/input'

/** A straight drag from (x0, y0) to (x1, y1) over `ms`, sampled every 16 ms. */
function drag(x0: number, y0: number, x1: number, y1: number, ms: number): Sample[] {
  const out: Sample[] = []
  for (let t = 0; t <= ms; t += 16) {
    const k = t / ms
    out.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, t })
  }
  out.push({ x: x1, y: y1, t: ms })
  return out
}

const tap = (onBall: boolean) => {
  const samples = drag(200, 400, 203, 404, 90)
  return classifyGesture({
    mode: pointerMode(false, false),
    down: samples[0]!,
    samples,
    end: samples.at(-1)!,
    onBall,
    ground: { x: 0.3, z: 0.6 },
    free: true,
  })
}

describe('classifyGesture', () => {
  it('throws the ball on an upward swipe of 200 px in 300 ms with the ball in hand', () => {
    const samples = drag(200, 600, 200, 400, 300)
    const g = classifyGesture({
      mode: pointerMode(true, false),
      down: samples[0]!,
      samples,
      end: samples.at(-1)!,
      onBall: false,
      ground: null,
      free: false,
    })
    expect(g.kind).toBe('throw')
    if (g.kind === 'throw') expect(g.swipe.vy).toBeGreaterThan(150)
  })

  it('does not throw on a downward swipe', () => {
    const samples = drag(200, 400, 200, 600, 300)
    const g = classifyGesture({
      mode: 'throw',
      down: samples[0]!,
      samples,
      end: samples.at(-1)!,
      onBall: false,
      ground: null,
      free: false,
    })
    expect(g.kind).toBe('none')
  })

  it('sends the puppy to a floor tap under 8 px away from the puppy', () => {
    expect(tap(false)).toEqual({ kind: 'goTo', x: 0.3, z: 0.6 })
  })

  it('picks up a ball lying on the floor when the tap lands on it', () => {
    expect(tap(true)).toEqual({ kind: 'takeBall' })
  })

  it('pets instead of tapping when the press starts on the puppy', () => {
    expect(pointerMode(false, true)).toBe('pet')
  })
})
