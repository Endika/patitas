// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { anatomy } from '@/engine/puppy/anatomy'
import { bodyShape } from '@/engine/room/bodies'
import { createSelectRing, ringRadius } from '@/engine/room/selectRing'

const ringIn = (scene: THREE.Scene) =>
  scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!

describe('ringRadius', () => {
  it.each(Object.values(BREEDS).map((b) => [b.id, b] as const))(
    'goes round the chest and rump of a %s standing, from midway between them',
    (_, breed) => {
      const shape = bodyShape(anatomy(breed)),
        { chest, rump } = shape.stand,
        mid = (chest.z + rump.z) / 2
      const r = ringRadius(shape)
      expect(r).toBeGreaterThan(mid - rump.z + rump.r)
      expect(r).toBeGreaterThan(chest.z - mid + chest.r)
      expect(r).toBeLessThan(0.45)
    },
  )
})

describe('createSelectRing', () => {
  it('starts hidden, in the accent colour, flat on the floor and out of the shadows', () => {
    const scene = new THREE.Scene()
    createSelectRing(scene)
    const ring = ringIn(scene)
    expect(ring.visible).toBe(false)
    const mat = ring.material as THREE.MeshBasicMaterial
    expect(mat.color.getHexString()).toBe('e0674f')
    expect(mat.opacity).toBeCloseTo(0.7)
    expect(mat.transparent).toBe(true)
    expect(ring.castShadow).toBe(false)
    expect(ring.receiveShadow).toBe(false)
    ring.geometry.computeBoundingBox()
    const box = ring.geometry.boundingBox!
    expect(box.max.y - box.min.y).toBeCloseTo(0)
  })

  it('stands under the puppy it follows, sized to it, and hides with none', () => {
    const scene = new THREE.Scene()
    const select = createSelectRing(scene)
    const ring = ringIn(scene)
    const position = ring.position,
      scale = ring.scale

    select.follow(0.4, -0.3, 0.35)
    expect(ring.visible).toBe(true)
    expect([ring.position.x, ring.position.z]).toEqual([0.4, -0.3])
    expect(ring.position.y).toBeGreaterThan(0)
    expect(ring.position.y).toBeLessThan(0.01)
    expect([ring.scale.x, ring.scale.z]).toEqual([0.35, 0.35])

    select.follow(-1, 0.2, 0.35)
    expect([ring.position.x, ring.position.z]).toEqual([-1, 0.2])
    // Followed frame after frame in place, with nothing new made
    expect(ring.position).toBe(position)
    expect(ring.scale).toBe(scale)

    select.hide()
    expect(ring.visible).toBe(false)
  })

  it('leaves the scene and frees its mesh on dispose', () => {
    const scene = new THREE.Scene()
    const select = createSelectRing(scene)
    const ring = ringIn(scene)
    let freed = 0
    ring.geometry.addEventListener('dispose', () => void freed++)
    ;(ring.material as THREE.Material).addEventListener('dispose', () => void freed++)
    select.dispose()
    expect(scene.children).not.toContain(ring)
    expect(freed).toBe(2)
  })
})
