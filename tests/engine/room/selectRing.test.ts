// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { anatomy } from '@/engine/puppy/anatomy'
import { bodyShape, createBody } from '@/engine/room/bodies'
import { beginBath, createBath } from '@/engine/room/bath'
import { beginBrush, createBrush } from '@/engine/room/brush'
import {
  createSelectRing,
  ringRadius,
  syncRing,
  type RingView,
  type SelectRing,
} from '@/engine/room/selectRing'

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

describe('syncRing', () => {
  const shape = bodyShape(anatomy(BREEDS.dorado))
  const puppy = (x: number): RingView => {
    const body = createBody()
    Object.assign(body.chest, { x, z: 1 })
    Object.assign(body.rump, { x, z: 0.6 })
    return { body, shape, bath: createBath(), brush: createBrush() }
  }
  const fakeRing = () => {
    const calls: string[] = []
    const ring: SelectRing = {
      follow: (x, z, r) => void calls.push(`follow:${x},${z},${r}`),
      hide: () => void calls.push('hide'),
      dispose() {},
    }
    return { ring, calls }
  }

  it('rings the chosen puppy, round the middle of its chest and rump', () => {
    const { ring, calls } = fakeRing()
    syncRing(ring, [puppy(-0.5), puppy(0.5)], 1)
    expect(calls).toEqual([`follow:0.5,0.8,${ringRadius(shape)}`])
  })

  it('hides with one puppy or none, where there is nobody to tell apart', () => {
    const { ring, calls } = fakeRing()
    syncRing(ring, [puppy(0)], 0)
    syncRing(ring, [], 0)
    expect(calls).toEqual(['hide', 'hide'])
  })

  it('hides while either puppy is bathed or brushed', () => {
    const { ring, calls } = fakeRing()
    const [a, b] = [puppy(-0.5), puppy(0.5)] as const
    beginBath(b.bath)
    syncRing(ring, [a, b], 0)
    const [c, d] = [puppy(-0.5), puppy(0.5)] as const
    beginBrush(c.brush)
    syncRing(ring, [c, d], 1)
    expect(calls).toEqual(['hide', 'hide'])
  })

  it('points at no one with a null or out-of-range index', () => {
    const { ring, calls } = fakeRing()
    const both = [puppy(-0.5), puppy(0.5)]
    syncRing(ring, both, null)
    syncRing(ring, both, 2)
    syncRing(ring, both, -1)
    expect(calls).toEqual(['hide', 'hide', 'hide'])
  })
})
