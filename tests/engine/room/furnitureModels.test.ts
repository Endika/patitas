// @vitest-environment jsdom
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { createCamera, fitCamera } from '@/engine/room/camera'
import { STANDARD_DECOR } from '@/domain/shop'
import { addFurniture, popOut } from '@/engine/room/furnitureModels'
import type { Spot } from '@/engine/room/furniture'

/** jsdom draws on no canvas: a 2D context that takes every call and draws nothing. */
const quiet: CanvasRenderingContext2D = new Proxy({} as CanvasRenderingContext2D, {
  get: (t, k) =>
    k in t
      ? t[k as keyof typeof t]
      : k === 'measureText'
        ? () => ({ width: 10 })
        : k === 'createRadialGradient'
          ? () => ({ addColorStop() {} })
          : () => {},
  set: (t, k, v) => Reflect.set(t, k, v),
})
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() =>
    quiet) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

/** Points round an oval of half sizes `r` across and `d` along the view. */
const rim = (s: Spot, r: number, d: number, n = 120) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2,
      u = Math.cos(a),
      v = Math.sin(a)
    return new THREE.Vector3(
      s.center.x + u * r * Math.cos(s.facing) + v * d * Math.sin(s.facing),
      0,
      s.center.z - u * r * Math.sin(s.facing) + v * d * Math.cos(s.facing),
    )
  })

/** The bed's outer size as drawn: its bolster's outer radius, times the group's scale. */
function drawn(group: THREE.Object3D): { across: number; along: number } {
  let outer = 0
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry) {
      const { radius, tube } = o.geometry.parameters
      outer = radius + tube
    }
  })
  return { across: outer * group.scale.x, along: outer * group.scale.z }
}

describe('the beds drawn on a resize', () => {
  it('are drawn the size the layout plans, across the size two beds shrink to and back', () => {
    const scene = new THREE.Scene()
    const furniture = addFurniture(scene, fitCamera(createCamera(), 1.78), 2)
    const beds = furniture.group.children.slice(0, 2)
    const sizes: number[] = []
    for (const aspect of [0.46, 0.65, 1.78, 0.46]) {
      furniture.layout(fitCamera(createCamera(), aspect))
      const [a, b] = furniture.spots.beds
      sizes.push(a!.radius)
      for (const [i, bed] of furniture.spots.beds.entries()) {
        const size = drawn(beds[i]!)
        expect(size.across).toBeCloseTo(bed.radius, 6)
        expect(size.along).toBeCloseTo(bed.depth, 6)
      }
      // The drawn ovals, not just the planned ones, keep 0.1 between their rims
      let gap = Infinity
      for (const p of rim(a!, drawn(beds[0]!).across, drawn(beds[0]!).along))
        for (const q of rim(b!, drawn(beds[1]!).across, drawn(beds[1]!).along))
          gap = Math.min(gap, p.distanceTo(q))
      expect(gap).toBeGreaterThanOrEqual(0.1)
    }
    // It did cross the shrink: smaller in portrait than at 1.78
    expect(sizes[0]!).toBeLessThan(sizes[2]!)
    furniture.dispose()
  })
})

describe('the rug', () => {
  it('lies where the layout puts it, one flat mesh that casts no shadow, and goes with the rest', () => {
    const scene = new THREE.Scene()
    const furniture = addFurniture(scene, fitCamera(createCamera(), 1.23), 2)
    const rugs: THREE.Mesh[] = []
    furniture.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.CircleGeometry) rugs.push(o)
    })
    expect(rugs).toHaveLength(1)
    const [rug] = rugs as [THREE.Mesh]
    const spot = furniture.spots.rug!
    expect(rug.visible).toBe(true)
    expect(rug.castShadow).toBe(false)
    expect(rug.position.x).toBeCloseTo(spot.center.x, 9)
    expect(rug.position.z).toBeCloseTo(spot.center.z, 9)
    expect([rug.scale.x, rug.scale.z]).toEqual([spot.radius, spot.depth])
    let gone = 0
    rug.geometry.addEventListener('dispose', () => gone++)
    ;(rug.material as THREE.Material).addEventListener('dispose', () => gone++)
    furniture.dispose()
    expect(gone).toBe(2)
  })
})

describe('the scale', () => {
  /** The scale's group: the one holding its display. */
  const scaleOf = (group: THREE.Object3D) =>
    group.children.find((g) => g.getObjectByName('scale-display'))!

  it('starts put away, and shows as far out as it is told', () => {
    const scene = new THREE.Scene()
    const furniture = addFurniture(scene, fitCamera(createCamera(), 0.46), 1)
    const scale = scaleOf(furniture.group)
    expect(scale.visible).toBe(false)
    furniture.scaleOut(1)
    expect(scale.visible).toBe(true)
    expect(scale.scale.toArray()).toEqual([1, 1, 1])
    furniture.scaleOut(0)
    expect(scale.visible).toBe(false)
    furniture.dispose()
  })

  it('grows from nothing to its size with a small overshoot on the way', () => {
    const sizes = Array.from({ length: 101 }, (_, i) => popOut(i / 100))
    expect(sizes[0]).toBeCloseTo(0, 12)
    expect(sizes[100]).toBe(1)
    expect(Math.max(...sizes)).toBeGreaterThan(1.05)
    expect(Math.max(...sizes)).toBeLessThan(1.15)
  })
})

describe('the colours bought in the shop', () => {
  /** The colour of every bolster in the room and of every bowl's dish, as hex. */
  const colours = (group: THREE.Object3D) => {
    const bolsters: string[] = [],
      dishes: string[] = []
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const mat = o.material as THREE.MeshStandardMaterial
      if (o.geometry instanceof THREE.TorusGeometry) bolsters.push(mat.color.getHexString())
      if (mat.userData.painted === 'dish') dishes.push(mat.color.getHexString())
    })
    return { bolsters, dishes }
  }

  it('paint every bed and every bowl, and back to the standard ones', () => {
    const furniture = addFurniture(new THREE.Scene(), fitCamera(createCamera(), 0.46), 2)
    const standard = colours(furniture.group)
    expect(new Set(standard.bolsters).size).toBe(1)

    furniture.setDecor({ ...STANDARD_DECOR, bed: 'sky', bowl: 'teal' })
    const bought = colours(furniture.group)
    expect(bought.bolsters).toHaveLength(2)
    expect(new Set(bought.bolsters).size).toBe(1)
    expect(bought.bolsters[0]).not.toBe(standard.bolsters[0])
    expect(bought.dishes).toHaveLength(2)
    expect(bought.dishes[0]).not.toBe(standard.dishes[0])

    furniture.setDecor(STANDARD_DECOR)
    expect(colours(furniture.group)).toEqual(standard)
  })
})
