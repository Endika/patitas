// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  cameraPosition,
  clampPlay,
  createCamera,
  fitCamera,
  PLAY,
  playLocal,
} from '@/engine/room/camera'

describe('fitCamera', () => {
  it('backs off further in portrait so the floor still fits the width', () => {
    const t = Math.tan(((30 / 2) * Math.PI) / 180)
    const portrait = fitCamera(createCamera(), 0.46)
    expect(portrait.dist).toBeCloseTo(0.85 / (t * 0.46))
    expect(portrait.tanH).toBeCloseTo(t * 0.46)
    const landscape = fitCamera(createCamera(), 2.1)
    expect(landscape.dist).toBeCloseTo(1.05 / t)
  })

  it('places the camera at az 0.4 and el 0.24 around the target', () => {
    const cam = fitCamera(createCamera(), 1)
    const p = cameraPosition(cam)
    expect(p.distanceTo(cam.target)).toBeCloseTo(cam.dist)
    expect(Math.atan2(p.x - cam.target.x, p.z - cam.target.z)).toBeCloseTo(0.4)
    expect(Math.asin((p.y - cam.target.y) / cam.dist)).toBeCloseTo(0.24)
  })
})

describe('clampPlay', () => {
  const cam = fitCamera(createCamera(), 0.46)

  it('returns a point inside the play area unchanged', () => {
    const [x, z] = clampPlay(cam, 0.1, 0.3)
    expect(x).toBeCloseTo(0.1)
    expect(z).toBeCloseTo(0.3)
  })

  it('brings a point far to the left back to the left edge at the same depth', () => {
    const q = playLocal(cam, 0, 0.6)
    // Far to the left: same depth, a long way along the negative side axis
    const x = cam.target.x + q.fx * q.d + q.fz * 20
    const z = cam.target.z + q.fz * q.d - q.fx * 20
    const far = playLocal(cam, x, z)
    expect(far.d).toBeCloseTo(q.d)
    expect(far.side).toBeLessThan(-q.half)
    const back = playLocal(cam, ...clampPlay(cam, x, z))
    expect(back.d).toBeCloseTo(q.d)
    expect(back.side).toBeCloseTo(-q.half)
  })

  it('keeps the depth between near and far', () => {
    const q = playLocal(cam, ...clampPlay(cam, 0, 50))
    expect(q.d).toBeLessThanOrEqual(PLAY.far + 1e-9)
    expect(q.d).toBeGreaterThanOrEqual(PLAY.near - 1e-9)
  })
})
