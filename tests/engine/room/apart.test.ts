// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { createMotionState, type MotionState } from '@/engine/motion/locomotion'
import { setPose } from '@/engine/motion/poses'
import { anatomy } from '@/engine/puppy/anatomy'
import { APART_STEP, apartBy, keepApart, type ClampTo } from '@/engine/room/apart'
import { bodyOf, bodyShape, createBody, sphereAt, SPHERES, type Body } from '@/engine/room/bodies'
import { clampPlay, clampPlayTo, createCamera, fitCamera, playWorld } from '@/engine/room/camera'

const SHAPE = bodyShape(anatomy(BREEDS.beagle))

const placed = (m: MotionState, out: Body = createBody()) =>
  bodyOf(m.pos, m.heading, m.pose, SHAPE, out)

function clearance(a: Body, b: Body) {
  let least = Infinity
  for (let i = 0; i < SPHERES; i++)
    for (let k = 0; k < SPHERES; k++) {
      const p = sphereAt(a, i),
        q = sphereAt(b, k)
      least = Math.min(least, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) - p.r - q.r)
    }
  return least
}

function at(x: number, z: number, heading = 0) {
  const m = createMotionState()
  m.pos.set(x, 0, z)
  m.heading = heading
  return m
}

/**
 * Frames of `keepApart` as the room runs it, bodies placed afresh each frame. Returns the most a
 * puppy moved in one frame and the frames it took to part them (Infinity if never).
 */
function frames(
  states: MotionState[],
  n: number,
  clamp?: ClampTo,
  fixed: readonly boolean[] | null = null,
) {
  let most = 0,
    parted = Infinity
  const bodies = states.map((m) => placed(m))
  for (let f = 0; f < n; f++) {
    states.forEach((m, i) => placed(m, bodies[i]))
    const before = states.map((m) => m.pos.clone())
    keepApart(states, bodies, clamp, fixed)
    states.forEach((m, i) => {
      most = Math.max(most, m.pos.distanceTo(before[i]!))
      // The bodies moved with them
      expect(placed(m).chest.x).toBeCloseTo(bodies[i]!.chest.x, 9)
    })
    if (parted === Infinity && clearance(placed(states[0]!), placed(states[1]!)) >= 0)
      parted = f + 1
  }
  return { most, parted }
}

describe('keepApart', () => {
  const starts: [string, [number, number, number], [number, number, number]][] = [
    ['head to tail', [0, 0, 0], [0, 0.45, 0]],
    ['side by side', [0, 0, 0], [0.1, 0.05, 0]],
    ['nose to nose', [0, 0, 0], [0.05, 0.6, Math.PI]],
    ['crossing', [0, 0, 0], [0.2, 0.3, Math.PI / 2]],
    ['on the same spot', [0, 0, 0], [0, 0, 0]],
  ]

  it.each(starts)(
    'parts two puppies standing %s a step at a time, until no sphere overlaps',
    (_, [ax, az, ah], [bx, bz, bh]) => {
      const a = at(ax, az, ah),
        b = at(bx, bz, bh)
      expect(clearance(placed(a), placed(b))).toBeLessThan(0)
      const { most, parted } = frames([a, b], 30)
      expect(most).toBeLessThanOrEqual(APART_STEP + 1e-9)
      expect(parted).toBeLessThan(30)
      expect(clearance(placed(a), placed(b))).toBeGreaterThanOrEqual(0)
    },
  )

  it('parts a light touch in the same frame', () => {
    const a = at(0, 0),
      b = at(0.355, 0)
    expect(clearance(placed(a), placed(b))).toBeLessThan(0)
    expect(frames([a, b], 1).parted).toBe(1)
  })

  it('lets two puppies stand closer side by side than head to tail', () => {
    // Touching lightly, each pair parts the short way and keeps how it stood
    const side = [at(0, 0), at(0.3, 0)],
      line = [at(0, 0), at(0, 0.6)]
    frames(side, 5)
    frames(line, 5)
    const gap = ([a, b]: MotionState[]) => Math.hypot(b!.pos.x - a!.pos.x, b!.pos.z - a!.pos.z)
    expect(gap(side)).toBeLessThan(0.45)
    expect(gap(line)).toBeGreaterThan(0.6)
    expect(Math.abs(line[1]!.pos.x - line[0]!.pos.x)).toBeLessThan(0.05)
  })

  it('leaves a sleeper in its place and pushes the awake one clear of it', () => {
    const sleeper = at(0, 0),
      awake = at(0.2, 0.1, -Math.PI / 2)
    setPose(sleeper, 'sleep')
    frames([awake, sleeper], 30)
    expect(sleeper.pos.length()).toBe(0)
    expect(clearance(placed(awake), placed(sleeper))).toBeGreaterThanOrEqual(0)
  })

  it('never moves the one on the scale: the other takes the whole push', () => {
    const weighed = at(0, 0, Math.PI / 2),
      walker = at(0.55, 0.05, -Math.PI / 2)
    walker.goal = new THREE.Vector3(-1, 0, 0.05)
    const { parted } = frames([weighed, walker], 30, undefined, [true, false])
    expect(weighed.pos.toArray()).toEqual([0, 0, 0])
    expect(parted).toBeLessThan(30)
  })

  it('stops a walker short of one it cannot nudge aside', () => {
    const sleeper = at(0, 0),
      walker = at(0, -0.5)
    setPose(sleeper, 'sleep')
    walker.goal = new THREE.Vector3(0, 0, 0.5)
    frames([walker, sleeper], 30)
    expect(walker.goal).toBeNull()
  })

  it('slides two pinned against the edges of a narrow room apart a step a frame, never a jump', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const clamp: ClampTo = (p) => clampPlayTo(cam, p)
    const [lx, lz] = playWorld(cam, 0.3, -9),
      [rx, rz] = playWorld(cam, 0.3, 9)
    const [ax, az] = clampPlay(cam, lx, lz),
      [bx, bz] = clampPlay(cam, rx, rz)
    const h = Math.atan2(bx - ax, bz - az)
    const a = at(ax, az, h),
      b = at(bx, bz, h + Math.PI)
    const { most, parted } = frames([a, b], 60, clamp)
    expect(most).toBeLessThanOrEqual(APART_STEP + 1e-9)
    expect(parted).toBeLessThan(60)
    for (const m of [a, b]) {
      const [cx, cz] = clampPlay(cam, m.pos.x, m.pos.z)
      expect(Math.hypot(cx - m.pos.x, cz - m.pos.z)).toBeLessThan(1e-9)
    }
  })
})

describe('apartBy', () => {
  it('is the least push along a line that clears every pair of spheres', () => {
    const a = placed(at(0, 0)),
      b = placed(at(0, 0.3))
    const t = apartBy(a, b, 0, 1)
    const moved = placed(at(0, 0.3 + t))
    expect(clearance(a, moved)).toBeGreaterThanOrEqual(-1e-9)
    expect(clearance(a, placed(at(0, 0.3 + t - 0.01)))).toBeLessThan(0)
    expect(apartBy(a, placed(at(3, 0)), 1, 0)).toBe(0)
  })
})

describe('clampPlayTo', () => {
  it('clamps in place exactly as clampPlay does', () => {
    const cam = fitCamera(createCamera(), 0.46)
    for (const [x, z] of [
      [0, 0],
      [5, 5],
      [-3, 1],
      [0.4, -2],
    ] as const) {
      const p = { x, z }
      clampPlayTo(cam, p)
      const [cx, cz] = clampPlay(cam, x, z)
      expect(p.x).toBeCloseTo(cx, 12)
      expect(p.z).toBeCloseTo(cz, 12)
    }
  })
})
