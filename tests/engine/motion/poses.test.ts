// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMotionState } from '@/engine/motion/locomotion'
import { POSES, POSE_TIME, setPose, stepPoses } from '@/engine/motion/poses'

describe('poses', () => {
  it('sits before lying down, then stands up', () => {
    const m = createMotionState()
    setPose(m, 'sit', 2.5, { pose: 'lie', dur: 6 })
    const at = (t: number) => {
      while (elapsed < t - 1e-9) {
        stepPoses(m, 0.01)
        elapsed += 0.01
      }
      return m.pose
    }
    let elapsed = 0
    expect(at(2.49)).toBe('sit')
    expect(at(2.52)).toBe('lie')
    expect(at(8.49)).toBe('lie')
    expect(at(8.54)).toBe('stand')
  })

  it('keeps the prototype values and drops the roll', () => {
    expect(POSE_TIME).toEqual({ sit: 5, lie: 7, belly: 6 })
    expect(Object.keys(POSES).sort()).toEqual(['belly', 'lie'])
  })

  it('blends the leg pose in while lying and clears the goal', () => {
    const m = createMotionState()
    setPose(m, 'lie')
    expect(m.poseDur).toBe(7)
    for (let n = 0; n < 120; n++) stepPoses(m, 1 / 60)
    expect(m.fk).toBeGreaterThan(0.98)
    expect(m.legPose[0]![0]).toBeCloseTo(POSES.lie.front[0], 2)
    expect(m.legPose[3]![1]).toBeCloseTo(POSES.lie.hind[1], 2)
  })

  it('clamps a large dt to 1/30 s', () => {
    const m = createMotionState()
    setPose(m, 'sit', 1)
    stepPoses(m, 5)
    expect(m.poseT).toBeCloseTo(1 / 30, 9)
    expect(m.pose).toBe('sit')
  })
})
