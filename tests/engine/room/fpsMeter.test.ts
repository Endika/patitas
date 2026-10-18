import { describe, expect, it } from 'vitest'
import { createFpsMeter } from '@/engine/room/fpsMeter'

describe('createFpsMeter', () => {
  it('reads about 60 fps from frames 16.67 ms apart', () => {
    const meter = createFpsMeter()
    for (let i = 0; i < 120; i++) meter.frame(i * (1000 / 60))
    expect(meter.fps()).toBeGreaterThan(59)
    expect(meter.fps()).toBeLessThan(61)
  })

  it('is 0 with fewer than two frames', () => {
    const meter = createFpsMeter()
    expect(meter.fps()).toBe(0)
    meter.frame(100)
    expect(meter.fps()).toBe(0)
  })

  it('stays finite and non-negative across a one second gap', () => {
    const meter = createFpsMeter()
    for (let i = 0; i < 30; i++) meter.frame(i * 16.67)
    for (let i = 0; i < 30; i++) meter.frame(1500 + i * 16.67)
    const fps = meter.fps()
    expect(Number.isFinite(fps)).toBe(true)
    expect(fps).toBeGreaterThanOrEqual(0)
  })

  it('ignores frames with the same timestamp', () => {
    const meter = createFpsMeter()
    meter.frame(5)
    meter.frame(5)
    expect(meter.fps()).toBe(0)
  })
})
