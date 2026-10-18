// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { anatomy } from '@/engine/puppy/anatomy'
import { legRigs } from '@/engine/motion/ik'
import {
  createLegStates,
  createMotionState,
  goTo,
  stepLocomotion,
  type LegState,
  type MotionState,
} from '@/engine/motion/locomotion'
import { setPose, stepPoses } from '@/engine/motion/poses'

const rigs = legRigs(anatomy(BREEDS.dorado))
const free = (x: number, z: number): [number, number] => [x, z]
const opts = { happy: 0.5, energy: 0.5, clamp: free, random: () => 0.9 }

function setup() {
  const m = createMotionState()
  return { m, legs: createLegStates(rigs, m) }
}

function run(m: MotionState, legs: LegState[], steps: number, withPoses = false) {
  for (let n = 0; n < steps; n++) {
    if (withPoses) stepPoses(m, 1 / 60)
    stepLocomotion(m, legs, 1 / 60)
  }
}

describe('stepLocomotion', () => {
  it('stops stepping once the puppy has arrived (regression: legs never stopped)', () => {
    const { m, legs } = setup()
    goTo(m, 0.3, 0.3, opts)
    run(m, legs, 600)
    expect(m.active).toBe(false)
    const phase = m.phase
    run(m, legs, 300)
    expect(m.phase).toBe(phase)
  })

  it('stops stepping while sitting', () => {
    const { m, legs } = setup()
    goTo(m, 0.3, 0.3, opts)
    run(m, legs, 20)
    setPose(m, 'sit', 60)
    run(m, legs, 600, true)
    expect(m.active).toBe(false)
    const phase = m.phase
    run(m, legs, 300, true)
    expect(m.phase).toBe(phase)
  })

  it.each([
    [0.3, 0.3],
    [1.2, -0.4],
    [-0.2, 0.15],
  ])('arrives at (%s, %s) without planted feet sliding', (x, z) => {
    const { m, legs } = setup()
    goTo(m, x, z, opts)
    for (let n = 0; n < 900; n++) {
      const before = legs.map((L) => (L.swinging ? null : L.planted.clone()))
      stepLocomotion(m, legs, 1 / 60)
      legs.forEach((L, i) => {
        const p = before[i]
        if (p && !L.swinging) expect(L.planted.distanceTo(p)).toBeLessThan(1e-3)
      })
    }
    expect(Math.hypot(m.pos.x - x, m.pos.z - z)).toBeLessThan(0.05)
  })

  it('clamps a large dt to 1/30 s', () => {
    const a = setup(),
      b = setup()
    goTo(a.m, 1, 1, opts)
    goTo(b.m, 1, 1, opts)
    run(a.m, a.legs, 30)
    run(b.m, b.legs, 30)
    const poseA = stepLocomotion(a.m, a.legs, 2)
    const poseB = stepLocomotion(b.m, b.legs, 1 / 30)
    expect(a.m.pos.toArray()).toEqual(b.m.pos.toArray())
    expect(a.m.phase).toBe(b.m.phase)
    expect(poseA).toEqual(poseB)
  })
})

describe('goTo', () => {
  it('picks the gait by distance and happiness, and energy can turn a trot into a hop', () => {
    const near = createMotionState()
    goTo(near, 0.2, 0, opts)
    expect(near.next).toBe('walk')
    const mid = createMotionState()
    goTo(mid, 0.6, 0, opts)
    expect(mid.next).toBe('trot')
    const eager = createMotionState()
    goTo(eager, 0.6, 0, { ...opts, energy: 1, random: () => 0.1 })
    expect(eager.next).toBe('hop')
    const happy = createMotionState()
    goTo(happy, 1.2, 0, { ...opts, happy: 0.5 })
    expect(happy.next).toBe('hop')
  })

  it('goes to the clamped point and stands up', () => {
    const m = createMotionState()
    setPose(m, 'lie')
    goTo(m, 5, 5, { ...opts, clamp: () => [1, 2] })
    expect(m.goal?.toArray()).toEqual([1, 0, 2])
    expect(m.pose).toBe('stand')
  })
})
