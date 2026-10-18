// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { debugClock } from '@/presentation/debugClock'

describe('debugClock', () => {
  it('starts at the given hour today and keeps running', () => {
    let real = new Date(2026, 9, 18, 10, 30).getTime()
    const clock = debugClock('21:05', () => real)
    expect(clock()).toBe(new Date(2026, 9, 18, 21, 5).getTime())
    real += 5000
    expect(clock()).toBe(new Date(2026, 9, 18, 21, 5, 5).getTime())
  })

  it.each([null, '', '25:00', '7:60', 'noche'])('keeps the real clock for %j', (at) => {
    const real = () => 1234
    expect(debugClock(at, real)).toBe(real)
  })
})
