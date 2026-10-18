// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  cameraPosition,
  clampPlay,
  createCamera,
  fitCamera,
  frameBox,
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

describe('frameBox', () => {
  const t = Math.tan(((30 / 2) * Math.PI) / 180)
  const puppy = new THREE.Box3(new THREE.Vector3(-0.2, 0, -0.35), new THREE.Vector3(0.2, 0.6, 0.35))

  /** The corners of the box in normalised device coordinates, as the real camera sees them. */
  const corners = (aspect: number) => {
    const cam = frameBox(createCamera(), puppy, aspect)
    const camera = new THREE.PerspectiveCamera(cam.fov, aspect, 0.05, 60)
    cameraPosition(cam, camera.position)
    camera.lookAt(cam.target)
    camera.updateMatrixWorld()
    const out: THREE.Vector3[] = []
    for (const x of [puppy.min.x, puppy.max.x])
      for (const y of [puppy.min.y, puppy.max.y])
        for (const z of [puppy.min.z, puppy.max.z])
          out.push(new THREE.Vector3(x, y, z).project(camera))
    return out
  }

  it('aims at the middle of the box from a little above', () => {
    const cam = frameBox(createCamera(), puppy, 1.2)
    expect(cam.target.x).toBeCloseTo(0)
    expect(cam.target.y).toBeCloseTo(0.3)
    expect(cam.target.z).toBeCloseTo(0)
    expect(cam.el).toBeCloseTo(0.3)
    expect(cam.tanH).toBeCloseTo(t * 1.2)
  })

  it('fits the height on a wide view and the width on a narrow one, plus half the depth', () => {
    const [c, sn] = [Math.cos(0.4), Math.sin(0.4)]
    const w = 0.4 * c + 0.7 * sn,
      d = 0.4 * sn + 0.7 * c
    expect(frameBox(createCamera(), puppy, 1.2).dist).toBeCloseTo(0.6 / (0.7 * 2 * t) + d / 2)
    expect(frameBox(createCamera(), puppy, 0.4).dist).toBeCloseTo(w / (0.7 * 2 * t * 0.4) + d / 2)
  })

  it.each([0.4, 1.2, 2])(
    'keeps the whole box in view and fills most of it at aspect %f',
    (aspect) => {
      const ndc = corners(aspect)
      for (const p of ndc) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1)
      }
      const spanX = Math.max(...ndc.map((p) => p.x)) - Math.min(...ndc.map((p) => p.x))
      const spanY = Math.max(...ndc.map((p) => p.y)) - Math.min(...ndc.map((p) => p.y))
      expect(Math.max(spanX, spanY) / 2).toBeGreaterThan(0.6)
    },
  )
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
