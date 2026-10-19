// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BACK_D, createBackdrop, SPLIT, type Backdrop } from '@/engine/room/backdrop'
import {
  cameraPosition,
  createCamera,
  fitCamera,
  playLocal,
  playWorld,
  type FixedCamera,
} from '@/engine/room/camera'
import { computeSpots, inMud } from '@/engine/room/furniture'

const ASPECTS = [0.46, 1, 2.3]

/** The room's camera for `aspect`, placed the way the scene places it. */
function view(aspect: number): { cam: FixedCamera; camera: THREE.PerspectiveCamera } {
  const cam = fitCamera(createCamera(), aspect)
  const camera = new THREE.PerspectiveCamera(cam.fov, aspect, 0.05, 60)
  cameraPosition(cam, camera.position)
  camera.lookAt(cam.target)
  camera.updateMatrixWorld()
  return { cam, camera }
}

const meshes = (group: THREE.Group) => {
  const out: THREE.Mesh[] = []
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) out.push(o)
  })
  return out
}

/** Every point of a 9 × 9 grid over the screen, corners included, lands on the backdrop. */
function expectCovered(backdrop: Backdrop, camera: THREE.Camera) {
  backdrop.group.updateMatrixWorld(true)
  const all = meshes(backdrop.group)
  const ray = new THREE.Raycaster()
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++) {
      const ndc = new THREE.Vector2(-1 + i / 4, -1 + j / 4)
      ray.setFromCamera(ndc, camera)
      expect(ray.intersectObjects(all, false).length, `ndc ${ndc.x}, ${ndc.y}`).toBeGreaterThan(0)
    }
}

describe('createBackdrop', () => {
  it.each(ASPECTS)('covers the whole frame, corners included, at aspect %f', (aspect) => {
    const { cam, camera } = view(aspect)
    const backdrop = createBackdrop(cam)
    expectCovered(backdrop, camera)
    backdrop.dispose()
  })

  it('lays itself out again for a new frame', () => {
    const wide = view(2.3)
    const backdrop = createBackdrop(view(0.46).cam)
    backdrop.layout(wide.cam)
    expectCovered(backdrop, wide.camera)
    backdrop.dispose()
  })

  it.each(ASPECTS)(
    'puts the garden left of the split and the house right at aspect %f',
    (aspect) => {
      const { cam } = view(aspect)
      const backdrop = createBackdrop(cam)
      for (let d = -2; d <= BACK_D; d += 0.4)
        for (const off of [-1.5, -0.3, -0.02, 0.02, 0.3, 1.5]) {
          const [x, z] = playWorld(cam, d, SPLIT + off)
          expect(backdrop.zoneAt(x, z)).toBe(off < 0 ? 'garden' : 'house')
        }
      backdrop.dispose()
    },
  )

  it('keeps the split where it is whatever the frame', () => {
    const backdrop = createBackdrop(view(0.46).cam)
    const [x, z] = playWorld(view(1).cam, 0.5, SPLIT - 0.05)
    backdrop.layout(view(2.3).cam)
    expect(backdrop.zoneAt(x, z)).toBe('garden')
    backdrop.dispose()
  })

  it.each(ASPECTS)(
    'grows grass only on the garden ground and out of the puddle at aspect %f',
    (aspect) => {
      const { cam } = view(aspect)
      const spots = computeSpots(cam, 2)
      const backdrop = createBackdrop(cam)
      backdrop.layout(cam, spots.mud)
      const blades = meshes(backdrop.group).find(
        (m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh && m.name === 'blades',
      )!
      expect(blades.count).toBeGreaterThan(500)
      // Under three times the old garden's 900 blades
      expect(blades.count).toBeLessThan(2700)
      backdrop.group.updateMatrixWorld(true)
      const m = new THREE.Matrix4(),
        p = new THREE.Vector3()
      for (let i = 0; i < blades.count; i++) {
        blades.getMatrixAt(i, m)
        p.setFromMatrixPosition(m).applyMatrix4(blades.matrixWorld)
        expect(backdrop.zoneAt(p.x, p.z)).toBe('garden')
        expect(playLocal(cam, p.x, p.z).d).toBeLessThan(BACK_D)
        expect(inMud(spots, p.x, p.z)).toBe(0)
      }
      backdrop.dispose()
    },
  )

  it('shows each blade from both sides with front faces only, so none is lit from below', () => {
    const backdrop = createBackdrop(view(1).cam)
    const blades = meshes(backdrop.group).find((m) => m.name === 'blades')!
    expect((blades.material as THREE.Material).side).toBe(THREE.FrontSide)
    const pos = blades.geometry.getAttribute('position')
    const facing = (i: number) => {
      const [a, b, c] = [0, 1, 2].map((k) =>
        new THREE.Vector3().fromBufferAttribute(pos, i * 3 + k),
      )
      return new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!))
    }
    // Every triangle has a twin wound the other way
    for (let i = 0; i < pos.count / 3; i += 2)
      expect(
        facing(i)
          .normalize()
          .dot(facing(i + 1).normalize()),
      ).toBeCloseTo(-1)
    backdrop.dispose()
  })

  it('casts no shadow from the backdrop and takes the puppies’ on the floor', () => {
    const backdrop = createBackdrop(view(1).cam)
    const all = meshes(backdrop.group)
    expect(all.every((m) => !m.castShadow)).toBe(true)
    expect(all.find((m) => m.name === 'floor')?.receiveShadow).toBe(true)
    backdrop.dispose()
  })

  it('frees every geometry and material on dispose and leaves the scene', () => {
    const scene = new THREE.Scene()
    const backdrop = createBackdrop(view(1).cam)
    scene.add(backdrop.group)
    const live = new Set<THREE.BufferGeometry | THREE.Material>()
    for (const m of meshes(backdrop.group))
      for (const r of [m.geometry, ...[m.material].flat()]) {
        live.add(r)
        r.addEventListener('dispose', () => live.delete(r))
      }
    expect(live.size).toBeGreaterThan(0)
    backdrop.dispose()
    expect([...live]).toEqual([])
    expect(backdrop.group.parent).toBeNull()
  })
})
