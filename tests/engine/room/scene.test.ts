// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { legRigs } from '@/engine/motion/ik'
import { createLegStates, createMotionState, stepLocomotion } from '@/engine/motion/locomotion'
import { stepPoses } from '@/engine/motion/poses'
import { anatomy } from '@/engine/puppy/anatomy'
import { clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import { keepInPlay } from '@/engine/room/scene'

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
