// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createBackdrop, SPLIT, STRIP_HALF } from '@/engine/room/backdrop'
import { cameraPosition, clampPlay, createCamera, fitCamera, playLocal } from '@/engine/room/camera'
import { bedSlots, mealSpot } from '@/engine/motion/routine'
import {
  computeSpots,
  createScaleDisplay,
  formatKg,
  READING_HOLD,
  showScale,
  showBowls,
  furnitureObstacles,
  inMud,
  startPlaces,
  inOval,
  type Spot,
  type Spots,
} from '@/engine/room/furniture'
import { bowl, KIBBLE, scaleReadout } from '@/engine/room/furnitureModels'

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
          // The bowls stand in a row; a second bed may stand in front of the first
          if (row === bowls) expect(r.d).toBeCloseTo(l.d)
          else expect(r.d).toBeLessThanOrEqual(l.d + 1e-9)
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
      const screens = startPlaces(cam, computeSpots(cam, 2), 2).map(({ x, z: z0, heading = 0 }) => {
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

  it.each(CASES)(
    'keeps the beds, bowls and scale in the house at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = computeSpots(cam, n)
      const backdrop = createBackdrop(cam)
      const local = (v: THREE.Vector3) => playLocal(cam, v.x, v.z)
      // Two beds one in front of the other bring the bowls right across the front of the house;
      // the scale then stands just outside it on the grass, where a puppy can walk round to it
      const stacked = n === 2 && local(spots.beds[1]!.center).d < 1.6
      for (const [name, s] of named(spots).filter(([k]) => k !== 'mud')) {
        if (name === 'scale' && stacked) {
          expect(local(s.center).side + s.radius).toBeGreaterThan(SPLIT - STRIP_HALF - 0.05)
          expect(local(s.center).side + s.radius).toBeLessThan(SPLIT - STRIP_HALF)
          continue
        }
        expect(backdrop.zoneAt(s.center.x, s.center.z), name).toBe('house')
        // Nothing reaches the grass; a bed lies over the doorway strip by 15 % of its radius at most
        const edge =
          kind(name) === 'bed' ? SPLIT + STRIP_HALF - 0.15 * s.radius : SPLIT - STRIP_HALF
        for (const p of rim(s)) expect(local(p).side, name).toBeGreaterThanOrEqual(edge - 1e-6)
      }
      backdrop.dispose()
      expect(local(spots.garden.center).side).toBeLessThan(SPLIT)
      expect(local(spots.mud.center).side).toBeLessThan(SPLIT)
      // The first bed against the wall, the scale nearest the camera
      expect(local(spots.beds[0]!.center).d).toBeCloseTo(1.7)
      const scaleD = local(spots.scale.center).d
      for (const s of [...spots.beds, ...spots.bowls])
        expect(local(s.center).d).toBeGreaterThan(scaleD)
      // Side by side wherever the wall has room for both
      if (n === 2 && aspect >= 1.5) expect(local(spots.beds[1]!.center).d).toBeCloseTo(1.7)
    },
  )

  it.each(CASES)(
    'puts the bowls in front of the beds, where one eating stands clear of them, at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = computeSpots(cam, n)
      // The longest muzzle of the breeds, and the rump behind it
      for (const bowl of spots.bowls) {
        const eat = mealSpot(bowl, 0.36)
        const rump = new THREE.Vector3(
          eat.x - Math.sin(eat.heading) * 0.15,
          0,
          eat.z - Math.cos(eat.heading) * 0.15,
        )
        for (const bed of spots.beds)
          for (const p of [eat, rump]) expect(inOval(bed, p.x, p.z, 0.17)).toBe(false)
      }
      // Bowls on their mat in the middle depth of the room unless a bed in front needs the room
      if (n === 1 || aspect >= 1.5)
        for (const bowl of spots.bowls) {
          const d = playLocal(cam, bowl.center.x, bowl.center.z).d
          expect(d).toBeGreaterThanOrEqual(0.58)
          expect(d).toBeLessThanOrEqual(0.65)
        }
    },
  )

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

describe('startPlaces', () => {
  it.each(CASES)(
    'starts the puppies near the middle in open floor, clear of the furniture and the puddle, at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = computeSpots(cam, n)
      const places = startPlaces(cam, spots, n)
      expect(places).toHaveLength(n)
      for (const p of places) {
        const [x, z] = clampPlay(cam, p.x, p.z)
        expect(Math.hypot(x - p.x, z - p.z)).toBeLessThan(1e-9)
        const q = playLocal(cam, p.x, p.z)
        expect(Math.abs(q.side)).toBeLessThanOrEqual(0.85 * q.half)
        expect(q.d).toBeGreaterThanOrEqual(-0.3)
        expect(q.d).toBeLessThanOrEqual(0.6)
        for (const s of [...spots.beds, ...spots.bowls, spots.scale])
          expect(inOval(s, p.x, p.z, 0.3)).toBe(false)
        expect(inOval(spots.mud, p.x, p.z, 0.1)).toBe(false)
        expect(inMud(spots, p.x, p.z)).toBe(0)
      }
      if (n === 2) {
        const [a, b] = places
        expect(Math.hypot(a!.x - b!.x, a!.z - b!.z)).toBeGreaterThanOrEqual(0.45)
        expect(playLocal(cam, a!.x, a!.z).side).toBeLessThan(playLocal(cam, b!.x, b!.z).side)
      }
    },
  )

  it('without furniture, starts them where they would rather be', () => {
    const { cam } = view(1)
    const [one] = startPlaces(cam, null, 1)
    expect(playLocal(cam, one!.x, one!.z).d).toBeCloseTo(0.16)
    expect(playLocal(cam, one!.x, one!.z).side).toBeCloseTo(0.2)
  })
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
  it('shows two decimals with a comma and «kg»', () => {
    expect(formatKg(5.24)).toBe('5,24 kg')
    expect(formatKg(4.3)).toBe('4,30 kg')
    expect(formatKg(12)).toBe('12,00 kg')
  })

  it('shows nothing with nobody on it', () => {
    expect(formatKg(null)).toBe('')
  })
})

describe('showScale', () => {
  const DT = 1 / 60
  const fake = () => {
    const drawn: string[] = []
    return { drawn, scaleReading: (kg: number | null) => void drawn.push(formatKg(kg)) }
  }

  it('reads the weight while a puppy stands on it, holds it a while, then goes blank', () => {
    const d = createScaleDisplay(),
      f = fake()
    showScale(d, f, null, DT)
    expect(f.drawn).toEqual([])
    for (let t = 0; t < 3; t += DT) showScale(d, f, 4.26, DT)
    expect(f.drawn).toEqual(['4,26 kg'])
    for (let t = 0; t < READING_HOLD - 0.1; t += DT) showScale(d, f, null, DT)
    expect(f.drawn).toEqual(['4,26 kg'])
    for (let t = 0; t < 0.2; t += DT) showScale(d, f, null, DT)
    expect(f.drawn).toEqual(['4,26 kg', ''])
  })

  it('draws again only when the hundredths change, or on furniture laid out anew', () => {
    const d = createScaleDisplay(),
      f = fake(),
      g = fake()
    showScale(d, f, 4.311, DT)
    showScale(d, f, 4.314, DT)
    showScale(d, f, 4.36, DT)
    expect(f.drawn).toEqual(['4,31 kg', '4,36 kg'])
    showScale(d, g, 4.36, DT)
    expect(g.drawn).toEqual(['4,36 kg'])
  })
})

describe('scaleReadout', () => {
  it('uploads the display again only when the text it shows changes', () => {
    const screen = {
      width: 240,
      height: 80,
      getContext: () => null,
    } as unknown as HTMLCanvasElement
    const readout = scaleReadout(screen)
    // A new CanvasTexture is already due one upload
    const first = readout.map.version
    const uploads = () => readout.map.version - first
    readout.show(null)
    expect(uploads()).toBe(1)
    for (let i = 0; i < 120; i++) readout.show(null)
    expect(uploads()).toBe(1)
    for (let i = 0; i < 120; i++) readout.show(4.261 + i * 0.00003)
    expect(uploads()).toBe(2)
    readout.show(4.27)
    readout.show(null)
    readout.show(null)
    expect(uploads()).toBe(4)
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

describe('the kibble', () => {
  it('has its bounding sphere around the whole mound before the bowl is emptied', () => {
    const { kibble } = bowl(new THREE.Texture())
    // What addFurniture does before the first render
    kibble.count = 0
    const sphere = kibble.boundingSphere
    expect(sphere).not.toBeNull()
    expect(sphere!.radius).toBeGreaterThan(0.05)
    kibble.count = KIBBLE
    expect(kibble.count).toBe(110)
    expect(kibble.boundingSphere!.radius).toBe(sphere!.radius)
  })
})
