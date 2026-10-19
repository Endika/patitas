// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cameraPosition, clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import { bedSlots } from '@/engine/motion/routine'
import {
  computeSpots,
  createScaleDisplay,
  formatKg,
  READING_HOLD,
  showScale,
  showBowls,
  furnitureObstacles,
  inMud,
  START_PLACES,
  type Spot,
  type Spots,
} from '@/engine/room/furniture'

const ASPECTS = [0.46, 1, 2.1]
const COUNTS = [1, 2] as const
const CASES = ASPECTS.flatMap((aspect) => COUNTS.map((n) => [aspect, n] as const))

/** Every piece by name, beds and bowls numbered: `bed0`, `bowl1`… */
const pieces = (spots: Spots): [string, Spot][] => [
  ...spots.beds.map((s, i): [string, Spot] => [`bed${i}`, s]),
  ...spots.bowls.map((s, i): [string, Spot] => [`bowl${i}`, s]),
  ['scale', spots.scale],
  ['garden', spots.garden],
  ['mud', spots.mud],
]
/** The pieces with a centre a puppy goes to: all but the garden, which holds the puddle. */
const named = (spots: Spots) => pieces(spots).filter(([name]) => name !== 'garden')
const kind = (name: string) => name.replace(/\d+$/, '')

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
  it.each(CASES)(
    'lays out a bed and a bowl for each puppy, left first, at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const { beds, bowls } = computeSpots(cam, n)
      expect([beds.length, bowls.length]).toEqual([n, n])
      for (const row of [beds, bowls])
        for (let i = 1; i < row.length; i++) {
          const l = playLocal(cam, row[i - 1]!.center.x, row[i - 1]!.center.z),
            r = playLocal(cam, row[i]!.center.x, row[i]!.center.z)
          expect(r.side).toBeGreaterThan(l.side)
          expect(r.d).toBeCloseTo(l.d)
        }
    },
  )

  it.each(CASES)('puts every spot inside the play area at aspect %f for %i', (aspect, n) => {
    const { cam } = view(aspect)
    for (const [name, { center }] of named(computeSpots(cam, n))) {
      const [x, z] = clampPlay(cam, center.x, center.z)
      expect(Math.hypot(x - center.x, z - center.z), name).toBeLessThan(1e-9)
      expect(center.y).toBe(0)
    }
  })

  it.each(CASES)('keeps every footprint on screen at aspect %f for %i', (aspect, n) => {
    const { cam, camera } = view(aspect)
    for (const [name, spot] of pieces(computeSpots(cam, n)))
      for (const p of rim(spot, 32)) {
        const q = p.project(camera)
        expect(Math.abs(q.x), name).toBeLessThan(1)
        expect(Math.abs(q.y), name).toBeLessThan(1)
      }
  })

  it.each(CASES)('keeps different pieces at least 0.5 apart at aspect %f for %i', (aspect, n) => {
    const list = named(computeSpots(view(aspect).cam, n))
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [na, a] = list[i]!,
          [nb, b] = list[j]!
        if (kind(na) === kind(nb)) continue
        // In the front row a narrow screen squeezes two bowls and the scale to a puppy's
        // personal space apart
        const front = [kind(na), kind(nb)].sort().join() === 'bowl,scale'
        expect(
          Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z),
          `${na}-${nb}`,
        ).toBeGreaterThan(front ? 0.45 : 0.5)
      }
  })

  it.each(CASES)('leaves at least 0.1 between footprints at aspect %f for %i', (aspect, n) => {
    const list = pieces(computeSpots(view(aspect).cam, n))
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [na, a] = list[i]!,
          [nb, b] = list[j]!
        // The puddle lies in the garden
        if (na === 'garden' && nb === 'mud') continue
        expect(gap(a, b), `${na}-${nb}`).toBeGreaterThanOrEqual(0.1)
      }
  })

  it.each(ASPECTS)('keeps the puddle inside the garden at aspect %f', (aspect) => {
    const { garden, mud } = computeSpots(view(aspect).cam, 2)
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
      const { mud } = computeSpots(cam, 2)
      // The two start places: a body 0.26 wide, 0.6 long and 0.55 tall, turned to `heading`
      const screens = START_PLACES[1]!.map(({ x, z: z0, heading = 0 }) => {
        const box = new THREE.Box2()
        for (const w of [-0.13, 0.13])
          for (const l of [-0.3, 0.3])
            for (const y of [0, 0.55]) {
              const p = new THREE.Vector3(
                x + w * Math.cos(heading) + l * Math.sin(heading),
                y,
                z0 - w * Math.sin(heading) + l * Math.cos(heading),
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
      expect(seen / all).toBeGreaterThanOrEqual(0.9)
    },
  )

  it.each(COUNTS)(
    'places the garden on the left, the beds back-right and the bowls at the front for %i',
    (n) => {
      const { cam } = view(1)
      const spots = computeSpots(cam, n)
      const local = (v: THREE.Vector3) => playLocal(cam, v.x, v.z)
      const mean = (row: Spot[], f: (p: ReturnType<typeof local>) => number) =>
        row.reduce((t, s) => t + f(local(s.center)), 0) / row.length
      expect(local(spots.garden.center).side).toBeLessThan(0)
      expect(local(spots.mud.center).side).toBeLessThan(0)
      expect(mean(spots.beds, (p) => p.side)).toBeGreaterThan(0)
      expect(mean(spots.bowls, (p) => p.side)).toBeLessThan(0)
      expect(local(spots.scale.center).side).toBeGreaterThan(0)
      expect(local(spots.mud.center).d).toBeLessThan(local(spots.garden.center).d)
      for (const s of spots.beds) expect(local(s.center).d).toBeGreaterThan(1)
      for (const s of spots.bowls) expect(local(s.center).d).toBeLessThan(0)
      // With two, the right-hand bowl is near the middle on a square screen: the scale goes back
      // on the right, out of the way of the one eating there
      if (n === 1) expect(local(spots.scale.center).d).toBeLessThan(0)
      else expect(local(spots.scale.center).d).toBeGreaterThan(0.5)
    },
  )

  it('keeps the scale in front beside two bowls on a wide screen', () => {
    const { cam } = view(1.78)
    const spots = computeSpots(cam, 2)
    const local = (v: THREE.Vector3) => playLocal(cam, v.x, v.z)
    expect(local(spots.scale.center).d).toBeLessThan(0)
    expect(local(spots.scale.center).side).toBeGreaterThan(0)
  })

  it('stretches the garden along the depth and grows it with the frame', () => {
    const narrow = computeSpots(view(0.46).cam, 1).garden,
      wide = computeSpots(view(2.1).cam, 1).garden
    expect(narrow.depth).toBeGreaterThan(narrow.radius)
    expect(narrow.depth).toBeGreaterThanOrEqual(0.45)
    expect(wide.depth).toBeGreaterThan(narrow.depth)
    expect(wide.depth).toBeLessThanOrEqual(0.8)
  })
})

describe('inMud', () => {
  const spots: Spots = computeSpots(view(1).cam, 1)
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

describe('the beds in frame', () => {
  it.each(CASES)(
    'keeps each sleeper and its overhang on screen at aspect %f for %i',
    (aspect, n) => {
      const { cam, camera } = view(aspect)
      const spots = computeSpots(cam, n)
      const facing = cam.az
      const ux = Math.cos(facing),
        uz = -Math.sin(facing)
      const vx = Math.sin(facing),
        vz = Math.cos(facing)
      // A curled sleeper reaches 0.45 across its bed (its head turned outwards, ears and all),
      // measured on the shots, and its head up to 0.3 towards the camera; the rim may reach further
      const slots = bedSlots(spots)
      expect(slots).toHaveLength(n)
      for (const [i, slot] of slots.entries()) {
        const reach = Math.max(0.45, spots.beds[i]!.radius)
        for (const off of [-reach, reach])
          for (const ahead of [0, 0.3])
            for (const y of [0, 0.4]) {
              const p = new THREE.Vector3(
                slot.x + ux * off + vx * ahead,
                y,
                slot.z + uz * off + vz * ahead,
              ).project(camera)
              expect(Math.abs(p.x)).toBeLessThanOrEqual(0.95)
            }
      }
    },
  )

  it.each(ASPECTS)('gives a lone puppy a bed a dorado fits in, at aspect %f', (aspect) => {
    const { cam } = view(aspect)
    const [alone] = computeSpots(cam, 1).beds
    expect(alone!.radius).toBeGreaterThanOrEqual(0.48)
    expect(alone!.depth / alone!.radius).toBeCloseTo(0.34 / 0.42)
    for (const bed of computeSpots(cam, 2).beds)
      expect([bed.radius, bed.depth]).toEqual([0.42, 0.34])
  })
})

describe('START_PLACES', () => {
  it.each(ASPECTS)(
    'starts one or two puppies in the play area, clear of the furniture and the puddle, at aspect %f',
    (aspect) => {
      const { cam } = view(aspect)
      for (const n of COUNTS) {
        const spots = computeSpots(cam, n)
        for (const places of START_PLACES)
          for (const p of places) {
            const [x, z] = clampPlay(cam, p.x, p.z)
            expect(Math.hypot(x - p.x, z - p.z)).toBeLessThan(1e-9)
            for (const c of furnitureObstacles(spots))
              expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(c.r + 0.3)
            expect(inMud(spots, p.x, p.z)).toBe(0)
          }
      }
    },
  )
})

describe('furnitureObstacles', () => {
  it('gives a circle around every bed, every bowl and the scale but not the garden', () => {
    const spots = computeSpots(view(1).cam, 2)
    const circles = furnitureObstacles(spots)
    expect(circles).toHaveLength(5)
    for (const s of [...spots.beds, ...spots.bowls, spots.scale]) {
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

describe('showScale', () => {
  const DT = 1 / 60
  const fake = () => {
    const drawn: string[] = []
    return { drawn, scaleReading: (kg: number | null) => void drawn.push(formatKg(kg)) }
  }

  it('reads the weight while a puppy stands on it, holds it a while, then goes back to zero', () => {
    const d = createScaleDisplay(),
      f = fake()
    showScale(d, f, null, DT)
    expect(f.drawn).toEqual([])
    for (let t = 0; t < 3; t += DT) showScale(d, f, 4.26, DT)
    expect(f.drawn).toEqual(['4,3 kg'])
    for (let t = 0; t < READING_HOLD - 0.1; t += DT) showScale(d, f, null, DT)
    expect(f.drawn).toEqual(['4,3 kg'])
    for (let t = 0; t < 0.2; t += DT) showScale(d, f, null, DT)
    expect(f.drawn).toEqual(['4,3 kg', '0,0 kg'])
  })

  it('draws again only when the tenths change, or on furniture laid out anew', () => {
    const d = createScaleDisplay(),
      f = fake(),
      g = fake()
    showScale(d, f, 4.31, DT)
    showScale(d, f, 4.34, DT)
    showScale(d, f, 4.36, DT)
    expect(f.drawn).toEqual(['4,3 kg', '4,4 kg'])
    showScale(d, g, 4.36, DT)
    expect(g.drawn).toEqual(['4,4 kg'])
  })
})

describe('showBowls', () => {
  it('puts back every bowl as full as its puppy left it on furniture laid out anew', () => {
    const shown = (puppies: 1 | 2, views: { place: number; bowl: number }[]) => {
      // Fresh furniture shows its bowls empty
      const levels = Array<number>(puppies).fill(0)
      showBowls({ bowlFill: (place, level) => void (levels[place] = level) }, views)
      return levels
    }
    expect(
      shown(2, [
        { place: 0, bowl: 0.25 },
        { place: 1, bowl: 1 },
      ]),
    ).toEqual([0.25, 1])
    // The left one leaves: the other moves to the one bowl and keeps what was in its own
    expect(shown(1, [{ place: 0, bowl: 1 }])).toEqual([1])
  })
})
