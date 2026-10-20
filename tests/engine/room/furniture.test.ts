// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createBackdrop, SPLIT, STRIP_HALF } from '@/engine/room/backdrop'
import {
  cameraPosition,
  clampPlay,
  createCamera,
  fitCamera,
  PLAY,
  playHalf,
  playLocal,
} from '@/engine/room/camera'
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
  startPlacesOf,
  walkingRound,
  walkRound,
  WALK_CLEARANCE,
  inOval,
  SLOT_APART,
  BOWL_STEP,
  type Spot,
  type Spots,
} from '@/engine/room/furniture'
import { bowl, bowlMats, KIBBLE, scaleReadout } from '@/engine/room/furnitureModels'
import { apart, clearOf, DORADO_BED, EAT_REACH } from '@/engine/room/layout'
import { apartBy } from '@/engine/room/apart'
import { bodyOf, bodyShape, createBody } from '@/engine/room/bodies'
import { anatomy } from '@/engine/puppy/anatomy'
import { BREEDS } from '@/domain/breeds'

const ASPECTS = [0.46, 1, 1.23, 2.1]
const COUNTS = [1, 2] as const
const CASES = ASPECTS.flatMap((aspect) => COUNTS.map((n) => [aspect, n] as const))
/** Every screen from tall phones to wide desktops, in steps of 0.05. */
const SWEEP = Array.from({ length: 41 }, (_, i) => +(0.4 + i * 0.05).toFixed(2)).flatMap((aspect) =>
  COUNTS.map((n) => [aspect, n] as const),
)
/** Wider still, from 0.3 to 3.5, for what must hold at any aspect. */
const WIDE = Array.from({ length: 65 }, (_, i) => +(0.3 + i * 0.05).toFixed(2)).flatMap((aspect) =>
  COUNTS.map((n) => [aspect, n] as const),
)
/** Each room is laid out once and shared by the tests. */
const laidOut = new Map<string, Spots>()
const spotsFor = (aspect: number, n: 1 | 2) => {
  const key = `${aspect} ${n}`
  if (!laidOut.has(key)) laidOut.set(key, computeSpots(view(aspect).cam, n))
  return laidOut.get(key)!
}

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

function view(aspect: number) {
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
  it.each(SWEEP)(
    'lays out a bed and a bowl for each puppy, left first, at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const { beds, bowls, fallback } = spotsFor(aspect, n)
      // Every rule kept, never the first candidate taken anyway
      expect(fallback).toBe(false)
      expect([beds.length, bowls.length]).toEqual([n, n])
      for (const row of [beds, bowls])
        for (let i = 1; i < row.length; i++) {
          const l = playLocal(cam, row[i - 1]!.center.x, row[i - 1]!.center.z),
            r = playLocal(cam, row[i]!.center.x, row[i]!.center.z)
          expect(r.side).toBeGreaterThan(l.side)
          // A second bed or bowl may stand in front of the first, never behind it
          expect(r.d).toBeLessThanOrEqual(l.d + 1e-9)
        }
    },
  )

  it.each(SWEEP)('puts every spot inside the play area at aspect %f for %i', (aspect, n) => {
    const { cam } = view(aspect)
    for (const [name, { center }] of named(spotsFor(aspect, n))) {
      const [x, z] = clampPlay(cam, center.x, center.z)
      expect(Math.hypot(x - center.x, z - center.z), name).toBeLessThan(1e-9)
      expect(center.y).toBe(0)
    }
  })

  it.each(SWEEP)('keeps every footprint on screen at aspect %f for %i', (aspect, n) => {
    const { camera } = view(aspect)
    for (const [name, spot] of pieces(spotsFor(aspect, n)))
      for (const p of rim(spot, 32)) {
        const q = p.project(camera)
        expect(Math.abs(q.x), name).toBeLessThan(1)
        expect(Math.abs(q.y), name).toBeLessThan(1)
      }
  })

  it.each(SWEEP)('keeps different pieces at least 0.5 apart at aspect %f for %i', (aspect, n) => {
    const list = named(spotsFor(aspect, n))
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [na, a] = list[i]!,
          [nb, b] = list[j]!
        if (kind(na) === kind(nb)) continue
        // A bowl and the scale may stand a puppy's personal space apart
        const front = [kind(na), kind(nb)].sort().join() === 'bowl,scale'
        expect(
          Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z),
          `${na}-${nb}`,
        ).toBeGreaterThan(front ? 0.45 : 0.5)
      }
  })

  it.each(SWEEP)('leaves at least 0.1 between footprints at aspect %f for %i', (aspect, n) => {
    const list = pieces(spotsFor(aspect, n))
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [na, a] = list[i]!,
          [nb, b] = list[j]!
        expect(gap(a, b), `${na}-${nb}`).toBeGreaterThanOrEqual(0.1)
      }
  })

  it.each(SWEEP)(
    'keeps the puddle on the grass, its middle well in the play area, at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const { mud } = spotsFor(aspect, n)
      // The drawn rim wobbles out to 1.08 of the oval
      for (const p of rim({ ...mud, radius: 1.08 * mud.radius, depth: 1.08 * mud.depth }))
        expect(playLocal(cam, p.x, p.z).side).toBeLessThan(SPLIT - STRIP_HALF)
      const c = playLocal(cam, mud.center.x, mud.center.z)
      expect(Math.abs(c.side)).toBeLessThanOrEqual(c.half - 0.05)
      expect(c.d).toBeGreaterThanOrEqual(PLAY.near + 0.1)
    },
  )

  it.each(WIDE)(
    'makes the puddle three times as big as it was at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const { mud } = spotsFor(aspect, n)
      // It was 0.55 of a garden 0.7 as wide as deep, its depth 0.35 of the play area's half width
      const was = Math.min(0.8, Math.max(0.45, 0.35 * playHalf(cam, 0.8)))
      expect(mud.radius * mud.depth).toBeGreaterThanOrEqual(3 * (0.55 * 0.7 * was) * (0.55 * was))
    },
  )

  it.each(SWEEP)(
    'puts the garden place on the grass, in play and clear of the puddle at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const { garden, mud } = spotsFor(aspect, n)
      const backdrop = createBackdrop(cam)
      for (const p of rim(garden)) expect(backdrop.zoneAt(p.x, p.z)).toBe('garden')
      backdrop.dispose()
      const c = playLocal(cam, garden.center.x, garden.center.z)
      expect(Math.abs(c.side)).toBeLessThanOrEqual(c.half - 0.1 + 1e-9)
      expect(gap(garden, mud)).toBeGreaterThanOrEqual(0.3)
    },
  )

  // Starting behind the puddle, or turned to the camera beside it, they leave it in sight
  it.each([0.46, ...SWEEP.filter(([, n]) => n === 2).map(([a]) => a)])(
    'leaves most of the puddle in sight of two puppies at their start at aspect %f',
    (aspect) => {
      const { cam, camera } = view(aspect)
      const spots = spotsFor(aspect, 2),
        { mud } = spots
      // The two start places: a dorado's body, 0.3 wide, 0.7 long and 0.7 tall, turned to `heading`
      const screens = startPlaces(cam, spots, 2).map(({ x, z: z0, heading = 0 }) => {
        const box = new THREE.Box2()
        for (const w of [-0.15, 0.15])
          for (const l of [-0.35, 0.35])
            for (const y of [0, 0.7]) {
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
      expect(seen / all).toBeGreaterThanOrEqual(0.95)
    },
  )

  it.each(CASES)(
    'keeps the beds, bowls and scale in the house at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = spotsFor(aspect, n)
      const backdrop = createBackdrop(cam)
      const local = (v: THREE.Vector3) => playLocal(cam, v.x, v.z)
      for (const [name, s] of named(spots).filter(([k]) => k !== 'mud' && k !== 'scale'))
        expect(backdrop.zoneAt(s.center.x, s.center.z), name).toBe('house')
      // Where the house has no room left at its front, the scale stands just outside it, by the strip
      const scale = local(spots.scale.center)
      if (backdrop.zoneAt(spots.scale.center.x, spots.scale.center.z) === 'garden')
        expect(scale.side + spots.scale.radius).toBeGreaterThan(SPLIT - STRIP_HALF - 0.1)
      backdrop.dispose()
      expect(local(spots.garden.center).side).toBeLessThan(SPLIT)
      expect(local(spots.mud.center).side).toBeLessThan(SPLIT)
      // The first bed against the wall; side by side wherever the wall has room for both
      expect(local(spots.beds[0]!.center).d).toBeCloseTo(1.7)
      if (n === 2 && aspect >= 1.5) expect(local(spots.beds[1]!.center).d).toBeCloseTo(1.7)
    },
  )

  it.each(COUNTS)(
    'at every aspect from 0.3 to 3.5 in steps of 0.01 for %i, keeps every rule, in play, and the scale in the house or by the strip',
    (n) => {
      const grass = SPLIT - STRIP_HALF,
        wrong: string[] = []
      for (let k = 0; k <= 320; k++) {
        const aspect = +(0.3 + k * 0.01).toFixed(2),
          { cam } = view(aspect),
          spots = computeSpots(cam, n)
        // Below LAYOUT_ASPECT the room is laid out as for it: everything must still be in play here
        if (spots.fallback || startPlacesOf(cam, spots, n).fallback)
          wrong.push(`${aspect} fallback`)
        for (const [name, { center }] of named(spots)) {
          const [x, z] = clampPlay(cam, center.x, center.z)
          if (Math.hypot(x - center.x, z - center.z) > 1e-9)
            wrong.push(`${aspect} ${name} out of play`)
        }
        const scale = playLocal(cam, spots.scale.center.x, spots.scale.center.z)
        const inHouse = scale.side - spots.scale.radius >= SPLIT + STRIP_HALF - 1e-9
        if (!inHouse && scale.side + spots.scale.radius < grass - 0.1 - 1e-9)
          wrong.push(
            `${aspect} scale ${(grass - scale.side - spots.scale.radius).toFixed(2)} off the strip`,
          )
      }
      expect(wrong).toEqual([])
    },
    60000,
  )

  it.each(WIDE)('keeps every bed, bowl and mat off the grass at aspect %f for %i', (aspect, n) => {
    const { cam } = view(aspect)
    const spots = spotsFor(aspect, n)
    const grass = SPLIT - STRIP_HALF
    const local = (v: { x: number; z: number }) => playLocal(cam, v.x, v.z)
    // A bed lies over the doorway strip by 15 % of its radius at most, never past the strip
    for (const s of spots.beds)
      for (const p of rim(s)) {
        expect(local(p).side).toBeGreaterThanOrEqual(SPLIT + STRIP_HALF - 0.15 * s.radius - 1e-6)
        expect(local(p).side).toBeGreaterThanOrEqual(grass - 1e-6)
      }
    // A bowl, and the mat under it, may be on the strip
    for (const s of spots.bowls)
      for (const p of rim(s)) expect(local(p).side).toBeGreaterThanOrEqual(grass - 1e-6)
    for (const mat of bowlMats(cam, spots))
      expect(local(mat).side - mat.across).toBeGreaterThanOrEqual(grass - 1e-6)
  })

  it.each(WIDE)(
    'keeps every mat its full size, rounded, under all of its bowls at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = spotsFor(aspect, n),
        mats = bowlMats(cam, spots),
        local = (v: { x: number; z: number }) => playLocal(cam, v.x, v.z)
      // 0.18 across from the middle of a lone bowl, and the row's half length more under two
      const full = mats.length === 1 ? ((n - 1) * BOWL_STEP) / 2 + 0.18 : 0.18
      for (const mat of mats) expect(mat.across).toBeCloseTo(full, 9)
      spots.bowls.forEach((b, i) => {
        const mat = local(mats[mats.length === 1 ? 0 : i]!),
          across = mats[mats.length === 1 ? 0 : i]!.across,
          at = local(b.center)
        expect(at.side - b.radius).toBeGreaterThanOrEqual(mat.side - across - 1e-9)
        expect(at.side + b.radius).toBeLessThanOrEqual(mat.side + across + 1e-9)
      })
    },
  )

  it.each(SWEEP)(
    'keeps every place two puppies stand at once SLOT_APART apart at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = spotsFor(aspect, n)
      const { places, fallback } = startPlacesOf(cam, spots, n)
      expect(fallback).toBe(false)
      // Each one's bed, where it eats and where it starts, and the scale
      const own = spots.beds.map((bed, i) => [
        bed.center,
        mealSpot(spots.bowls[i]!, EAT_REACH),
        places[i]!,
      ])
      const far = (a: { x: number; z: number }, b: { x: number; z: number }) =>
        Math.hypot(a.x - b.x, a.z - b.z)
      if (n === 2) {
        for (const a of own[0]!)
          for (const b of own[1]!) expect(far(a, b)).toBeGreaterThanOrEqual(SLOT_APART - 1e-6)
        for (const a of own.flat())
          expect(far(a, spots.scale.center)).toBeGreaterThanOrEqual(SLOT_APART - 1e-6)
      }
      // That is two bodies side by side, beagles the widest, and some room
      const beagle = bodyShape(anatomy(BREEDS.beagle))
      const side = (x: number) => bodyOf({ x, z: 0 }, 0, 'stand', beagle, createBody())
      expect(SLOT_APART).toBeGreaterThanOrEqual(apartBy(side(0), side(0), 1, 0) + 0.08)
    },
  )

  it.each(SWEEP)(
    'puts the bowls in front of the beds, where one eating stands clear of them, at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = spotsFor(aspect, n)
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
      if (n === 1 || aspect >= 1.35)
        for (const bowl of spots.bowls) {
          const d = playLocal(cam, bowl.center.x, bowl.center.z).d
          expect(d).toBeGreaterThanOrEqual(0.58)
          expect(d).toBeLessThanOrEqual(0.65)
        }
    },
  )
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
  it.each(SWEEP)(
    'keeps each sleeper and its overhang on screen at aspect %f for %i',
    (aspect, n) => {
      const { cam, camera } = view(aspect)
      const spots = spotsFor(aspect, n)
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

  it.each(SWEEP.filter(([, n]) => n === 2).map(([a]) => a))(
    'gives each puppy a bed a curled dorado fits in, at aspect %f',
    (aspect) => {
      const [alone] = spotsFor(aspect, 1).beds
      expect(alone!.radius).toBeGreaterThanOrEqual(0.48)
      expect(alone!.depth / alone!.radius).toBeCloseTo(0.34 / 0.42)
      // Two may be smaller on a narrow screen, never below a curled dorado's reach and its bolster
      for (const bed of spotsFor(aspect, 2).beds) {
        expect(bed.radius).toBeGreaterThanOrEqual(DORADO_BED - 1e-9)
        expect(bed.radius).toBeLessThanOrEqual(0.42)
        expect(bed.depth / bed.radius).toBeCloseTo(0.34 / 0.42)
      }
      if (aspect >= 1) for (const bed of spotsFor(aspect, 2).beds) expect(bed.radius).toBe(0.42)
    },
  )
})

describe('startPlaces', () => {
  it.each(SWEEP)(
    'starts the puppies in open floor, clear of the furniture and the puddle, at aspect %f for %i',
    (aspect, n) => {
      const { cam } = view(aspect)
      const spots = spotsFor(aspect, n)
      const places = startPlaces(cam, spots, n)
      expect(places).toHaveLength(n)
      for (const p of places) {
        const [x, z] = clampPlay(cam, p.x, p.z)
        expect(Math.hypot(x - p.x, z - p.z)).toBeLessThan(1e-9)
        const q = playLocal(cam, p.x, p.z)
        expect(Math.abs(q.side)).toBeLessThanOrEqual(0.85 * q.half + 1e-9)
        // In the near two thirds of the room, so they come in in sight
        expect(q.d).toBeGreaterThanOrEqual(-0.46)
        expect(q.d).toBeLessThanOrEqual(1.21)
        for (const s of [...spots.beds, ...spots.bowls, spots.scale])
          expect(inOval(s, p.x, p.z, 0.3)).toBe(false)
        expect(inOval(spots.mud, p.x, p.z, 0.1)).toBe(false)
        expect(inMud(spots, p.x, p.z)).toBe(0)
      }
      if (n === 2) {
        const [a, b] = places
        expect(Math.hypot(a!.x - b!.x, a!.z - b!.z)).toBeGreaterThanOrEqual(SLOT_APART - 1e-6)
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

describe('clearOf', () => {
  it('measures a long oval rim to rim, where the summed oval passes one a little too close', () => {
    const puddle = { d: 0, side: 0, radius: 0.18, depth: 0.8 }
    const bowl = (d: number, side: number) => ({ d, side, radius: 0.13, depth: 0.13 })
    // 0.087 apart by its flank, and 0.124
    expect(apart(bowl(0.75, 0.3), puddle, 0.1)).toBe(true)
    expect(clearOf(bowl(0.75, 0.3), puddle, 0.1)).toBe(false)
    expect(clearOf(bowl(0.6, 0.38), puddle, 0.1)).toBe(true)
    // Overlapping, or one inside the other, is never clear
    expect(clearOf(bowl(0, 0.1), puddle, 0.1)).toBe(false)
    expect(clearOf(bowl(0, 0), puddle, 0)).toBe(false)
  })
})

describe('walkRound', () => {
  it('groups pieces with no way between them, however many join up, and leaves the rest alone', () => {
    const at = (x: number, r = 0.1) => ({ x, z: 0, r })
    // 0.3 between the first two and the next two: no way through; 0.6 to the last
    const groups = walkRound([at(0), at(0.5), at(1), at(2.3)])
    expect(groups.map((g) => g.map((c) => c.x))).toEqual([[0, 0.5, 1], [2.3]])
    expect(WALK_CLEARANCE).toBeCloseTo(0.47)
  })

  it('is worked out once per layout, for each piece walked to', () => {
    const spots = spotsFor(1, 2)
    expect(spots.walk).toHaveLength(spots.beds.length + spots.bowls.length + 2)
    expect(walkingRound(spots, spots.bowls[0]!)).toBe(spots.walk![2])
    expect(walkingRound(spots, spots.mud)).toBe(spots.walk![5])
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
