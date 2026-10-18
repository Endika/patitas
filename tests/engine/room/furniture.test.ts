// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cameraPosition, clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import {
  computeSpots,
  formatKg,
  furnitureObstacles,
  inMud,
  type Spot,
  type Spots,
} from '@/engine/room/furniture'

const ASPECTS = [0.46, 1, 2.1]
const NAMES = ['bed', 'bowl', 'scale', 'mud'] as const
const FOOTPRINTS = ['bed', 'bowl', 'scale', 'garden', 'mud'] as const

const view = (aspect: number) => {
  const cam = fitCamera(createCamera(), aspect)
  const camera = new THREE.PerspectiveCamera(cam.fov, aspect, 0.05, 60)
  cameraPosition(cam, camera.position)
  camera.lookAt(cam.target)
  camera.updateMatrixWorld()
  return { cam, camera }
}

/** A point of the footprint's ellipse: `u` across the screen, `v` towards the camera, both in -1..1. */
const at = (s: Spot, u: number, v: number) =>
  new THREE.Vector3(
    s.center.x + u * s.radius * Math.cos(s.facing) + v * s.depth * Math.sin(s.facing),
    0,
    s.center.z - u * s.radius * Math.sin(s.facing) + v * s.depth * Math.cos(s.facing),
  )

const rim = (s: Spot, n = 96) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return at(s, Math.cos(a), Math.sin(a))
  })

/** Edge-to-edge distance between two footprints, from points along both outlines. */
const gap = (a: Spot, b: Spot) => {
  let best = Infinity
  for (const p of rim(a)) for (const q of rim(b)) best = Math.min(best, p.distanceTo(q))
  return best
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
    for (const name of FOOTPRINTS)
      for (const p of rim(spots[name], 32)) {
        const n = p.project(camera)
        expect(Math.abs(n.x), name).toBeLessThan(1)
        expect(Math.abs(n.y), name).toBeLessThan(1)
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

  it.each(ASPECTS)('leaves at least 0.1 between footprints at aspect %f', (aspect) => {
    const spots = computeSpots(view(aspect).cam)
    for (let i = 0; i < FOOTPRINTS.length; i++)
      for (let j = i + 1; j < FOOTPRINTS.length; j++) {
        const a = FOOTPRINTS[i]!,
          b = FOOTPRINTS[j]!
        // The puddle lies in the garden
        if (a === 'garden' && b === 'mud') continue
        expect(gap(spots[a], spots[b]), `${a}-${b}`).toBeGreaterThanOrEqual(0.1)
      }
  })

  it.each(ASPECTS)('keeps the puddle inside the garden at aspect %f', (aspect) => {
    const { garden, mud } = computeSpots(view(aspect).cam)
    for (const p of rim(mud)) {
      const q = playLocal(view(aspect).cam, p.x, p.z),
        g = playLocal(view(aspect).cam, garden.center.x, garden.center.z)
      expect(
        ((q.side - g.side) / garden.radius) ** 2 + ((q.d - g.d) / garden.depth) ** 2,
      ).toBeLessThan(1)
    }
  })

  it.each(ASPECTS)(
    'leaves most of the puddle in sight of two puppies at their start at aspect %f',
    (aspect) => {
      const { cam, camera } = view(aspect)
      const { mud } = computeSpots(cam)
      // The two start places: a body 0.26 wide, 0.6 long and 0.55 tall, turned to `heading`
      const screens = [
        { x: -0.32, heading: 0.25 },
        { x: 0.32, heading: -0.25 },
      ].map(({ x, heading }) => {
        const box = new THREE.Box2()
        for (const w of [-0.13, 0.13])
          for (const l of [-0.3, 0.3])
            for (const y of [0, 0.55]) {
              const p = new THREE.Vector3(
                x + w * Math.cos(heading) + l * Math.sin(heading),
                y,
                -w * Math.sin(heading) + l * Math.cos(heading),
              ).project(camera)
              box.expandByPoint(new THREE.Vector2(p.x, p.y))
            }
        return box
      })
      let seen = 0,
        all = 0
      for (let r = 1; r <= 6; r++)
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2,
            p = at(mud, (r / 6.5) * Math.cos(a), (r / 6.5) * Math.sin(a)).project(camera)
          all++
          if (!screens.some((b) => b.containsPoint(new THREE.Vector2(p.x, p.y)))) seen++
        }
      expect(seen / all).toBeGreaterThanOrEqual(0.5)
    },
  )

  it('places the garden on the left, the bed back-right and bowl and scale at the front', () => {
    const { cam } = view(1)
    const spots = computeSpots(cam)
    const local = (v: THREE.Vector3) => playLocal(cam, v.x, v.z)
    expect(local(spots.garden.center).side).toBeLessThan(0)
    expect(local(spots.mud.center).side).toBeLessThan(0)
    expect(local(spots.bed.center).side).toBeGreaterThan(0)
    expect(local(spots.bowl.center).side).toBeLessThan(0)
    expect(local(spots.scale.center).side).toBeGreaterThan(0)
    expect(local(spots.mud.center).d).toBeLessThan(local(spots.garden.center).d)
    expect(local(spots.bed.center).d).toBeGreaterThan(1)
    expect(local(spots.bowl.center).d).toBeLessThan(0)
    expect(local(spots.scale.center).d).toBeLessThan(0)
  })

  it('stretches the garden along the depth and grows it with the frame', () => {
    const narrow = computeSpots(view(0.46).cam).garden,
      wide = computeSpots(view(2.1).cam).garden
    expect(narrow.depth).toBeGreaterThan(narrow.radius)
    expect(narrow.depth).toBeGreaterThanOrEqual(0.45)
    expect(wide.depth).toBeGreaterThan(narrow.depth)
    expect(wide.depth).toBeLessThanOrEqual(0.8)
  })
})

describe('inMud', () => {
  const spots: Spots = computeSpots(view(1).cam)
  const { mud } = spots

  it('is 1 at the centre and 0 from inside the drawn edge outwards', () => {
    const c = at(mud, 0, 0)
    expect(inMud(spots, c.x, c.z)).toBeCloseTo(1)
    for (const [u, v] of [
      [0.9, 0],
      [0, -0.9],
      [1.5, 0],
      [0, 1.5],
    ] as const) {
      const p = at(mud, u, v)
      expect(inMud(spots, p.x, p.z)).toBe(0)
    }
    expect(inMud(spots, c.x + 5, c.z + 5)).toBe(0)
  })

  it('falls off smoothly towards the edge', () => {
    let last = 1
    for (let i = 1; i <= 10; i++) {
      const p = at(mud, i / 10, 0)
      const v = inMud(spots, p.x, p.z)
      expect(v).toBeLessThanOrEqual(last)
      expect(last - v).toBeLessThan(0.35)
      last = v
    }
  })
})

describe('furnitureObstacles', () => {
  it('gives a circle around the bed, the bowl and the scale but not the garden', () => {
    const spots = computeSpots(view(1).cam)
    const circles = furnitureObstacles(spots)
    expect(circles).toHaveLength(3)
    for (const name of ['bed', 'bowl', 'scale'] as const) {
      const s = spots[name]
      expect(circles).toContainEqual({
        x: s.center.x,
        z: s.center.z,
        r: Math.max(s.radius, s.depth),
      })
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
