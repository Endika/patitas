// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cameraPosition, clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import {
  computeSpots,
  formatKg,
  furnitureObstacles,
  inMud,
  type Spots,
} from '@/engine/room/furniture'

const ASPECTS = [0.46, 1, 2.1]
const NAMES = ['bed', 'bowl', 'scale', 'mud'] as const

const view = (aspect: number) => {
  const cam = fitCamera(createCamera(), aspect)
  const camera = new THREE.PerspectiveCamera(cam.fov, aspect, 0.05, 60)
  cameraPosition(cam, camera.position)
  camera.lookAt(cam.target)
  camera.updateMatrixWorld()
  return { cam, camera }
}

describe('computeSpots', () => {
  it.each(ASPECTS)('puts every spot inside the play area at aspect %f', (aspect) => {
    const { cam } = view(aspect)
    const spots = computeSpots(cam)
    for (const name of NAMES) {
      const { center } = spots[name]
      const [x, z] = clampPlay(cam, center.x, center.z)
      expect(Math.hypot(x - center.x, z - center.z), name).toBeLessThan(1e-9)
      expect(center.y).toBe(0)
    }
  })

  it.each(ASPECTS)('keeps every footprint on screen at aspect %f', (aspect) => {
    const { cam, camera } = view(aspect)
    const spots = computeSpots(cam)
    for (const name of [...NAMES, 'garden'] as const) {
      const { center, radius } = spots[name]
      for (let a = 0; a < 16; a++) {
        const p = new THREE.Vector3(
          center.x + radius * Math.cos((a / 16) * Math.PI * 2),
          0,
          center.z + radius * Math.sin((a / 16) * Math.PI * 2),
        ).project(camera)
        expect(Math.abs(p.x), name).toBeLessThan(1)
        expect(Math.abs(p.y), name).toBeLessThan(1)
      }
    }
  })

  it.each(ASPECTS)('keeps the spots at least 0.5 apart at aspect %f', (aspect) => {
    const spots = computeSpots(view(aspect).cam)
    for (let i = 0; i < NAMES.length; i++)
      for (let j = i + 1; j < NAMES.length; j++) {
        const a = spots[NAMES[i]!].center,
          b = spots[NAMES[j]!].center
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${NAMES[i]}-${NAMES[j]}`).toBeGreaterThan(0.5)
      }
  })

  it('places the garden back-left, the bed back-right and bowl and scale at the front', () => {
    const { cam } = view(1)
    const spots = computeSpots(cam)
    const local = (v: THREE.Vector3) => playLocal(cam, v.x, v.z)
    expect(local(spots.mud.center).side).toBeLessThan(0)
    expect(local(spots.bed.center).side).toBeGreaterThan(0)
    expect(local(spots.bowl.center).side).toBeLessThan(0)
    expect(local(spots.scale.center).side).toBeGreaterThan(0)
    expect(local(spots.mud.center).d).toBeGreaterThan(1)
    expect(local(spots.bed.center).d).toBeGreaterThan(1)
    expect(local(spots.bowl.center).d).toBeLessThan(0)
    expect(local(spots.scale.center).d).toBeLessThan(0)
  })
})

describe('inMud', () => {
  const spots: Spots = computeSpots(view(1).cam)
  const { center, radius } = spots.mud

  it('is 1 at the centre and 0 at and beyond the radius', () => {
    expect(inMud(spots, center.x, center.z)).toBeCloseTo(1)
    expect(inMud(spots, center.x + radius, center.z)).toBe(0)
    expect(inMud(spots, center.x, center.z - radius * 1.5)).toBe(0)
    expect(inMud(spots, center.x + 5, center.z + 5)).toBe(0)
  })

  it('falls off smoothly towards the edge', () => {
    let last = 1
    for (let i = 1; i <= 10; i++) {
      const v = inMud(spots, center.x + (radius * i) / 10, center.z)
      expect(v).toBeLessThanOrEqual(last)
      expect(last - v).toBeLessThan(0.35)
      last = v
    }
  })
})

describe('furnitureObstacles', () => {
  it('gives a circle for the bed, the bowl and the scale but not the garden', () => {
    const spots = computeSpots(view(1).cam)
    const circles = furnitureObstacles(spots)
    expect(circles).toHaveLength(3)
    for (const name of ['bed', 'bowl', 'scale'] as const) {
      const s = spots[name]
      expect(circles).toContainEqual({ x: s.center.x, z: s.center.z, r: s.radius })
    }
  })
})

describe('formatKg', () => {
  it('shows one decimal with a comma and «kg»', () => {
    expect(formatKg(4.3)).toBe('4,3 kg')
    expect(formatKg(4.26)).toBe('4,3 kg')
    expect(formatKg(12)).toBe('12,0 kg')
  })

  it('reads zero with nobody on it', () => {
    expect(formatKg(null)).toBe('0,0 kg')
  })
})
