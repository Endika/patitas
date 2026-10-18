// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { legRigs } from '@/engine/motion/ik'
import { createLegStates, createMotionState, stepLocomotion } from '@/engine/motion/locomotion'
import { stepPoses } from '@/engine/motion/poses'
import { anatomy } from '@/engine/puppy/anatomy'
import { clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import { keepInPlay, pickQuality, shadowBox } from '@/engine/room/scene'

describe('keepInPlay', () => {
  it('walks a puppy left outside a narrower play area back in without jumping', () => {
    const cam = fitCamera(createCamera(), 1.8)
    const m = createMotionState()
    const q = playLocal(cam, 0, 0)
    // Near the right edge of a landscape screen
    const [x, z] = clampPlay(cam, q.fx * 0.3 - q.fz * 9, q.fz * 0.3 + q.fx * 9)
    m.pos.set(x, 0, z)
    const legs = createLegStates(legRigs(anatomy(BREEDS.shiba)), m)

    fitCamera(cam, 0.46)
    const out = playLocal(cam, m.pos.x, m.pos.z)
    expect(Math.abs(out.side)).toBeGreaterThan(out.half)
    expect(keepInPlay(m, cam, { happy: 0.3, energy: 0.5 })).toBe(true)

    let most = 0
    for (let f = 0; f < 6 * 60; f++) {
      const before = m.pos.clone()
      stepPoses(m, 1 / 60)
      stepLocomotion(m, legs, 1 / 60)
      most = Math.max(most, before.distanceTo(m.pos))
    }
    const end = playLocal(cam, m.pos.x, m.pos.z)
    expect(Math.abs(end.side)).toBeLessThanOrEqual(end.half + 0.05)
    expect(most).toBeLessThan(0.03)
    expect(keepInPlay(m, cam, { happy: 0.3, energy: 0.5 })).toBe(false)
  })
})

describe('pickQuality', () => {
  it('trims fur and resolution for two puppies on a phone', () => {
    expect(pickQuality(1, true)).toEqual({ shells: 16, dpr: 1.6, shadowMap: 2048 })
    expect(pickQuality(2, true)).toEqual({ shells: 12, dpr: 1.5, shadowMap: 1024 })
    expect(pickQuality(1, false)).toEqual({ shells: 24, dpr: 2, shadowMap: 2048 })
    expect(pickQuality(2, false)).toEqual({ shells: 24, dpr: 2, shadowMap: 2048 })
  })
})

describe('shadowBox', () => {
  it('keeps the prototype box around one puppy', () => {
    expect(shadowBox([{ x: 0.3, z: -0.2 }])).toEqual({ x: 0.3, z: -0.2, half: 1.1 })
  })

  it('grows to cover two puppies far apart', () => {
    const box = shadowBox([
      { x: -1.2, z: 0 },
      { x: 1.4, z: 0.6 },
    ])
    expect(box.x).toBeCloseTo(0.1)
    expect(box.z).toBeCloseTo(0.3)
    for (const p of [
      { x: -1.2, z: 0 },
      { x: 1.4, z: 0.6 },
    ])
      expect(Math.hypot(p.x - box.x, p.z - box.z) + 0.5).toBeLessThanOrEqual(box.half)
  })
})
