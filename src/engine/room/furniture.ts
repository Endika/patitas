import * as THREE from 'three'
import { clamp, type Vec3 } from '@/engine/math'
import { PLAY, playLocal, playWorld, type FixedCamera } from './camera'
import {
  findStarts,
  layOut,
  mudPlace,
  pottyPlace,
  START_WANT,
  wantedStarts,
  type Oval,
} from './layout'

/** An oval footprint on the floor, turned to face the camera. */
export interface Spot {
  center: Vec3
  /** Half size across the screen. */
  radius: number
  /** Half size along the view, away from the camera. */
  depth: number
  /** The camera's azimuth: the oval's `depth` axis points at the camera. */
  facing: number
}

/**
 * Where the furniture stands: a bed and a bowl for each puppy, left first, then the scale; on the
 * grass, the `mud` puddle and, away from it, the `garden` place where a puppy relieves itself.
 */
export interface Spots {
  beds: Spot[]
  bowls: Spot[]
  scale: Spot
  mud: Spot
  garden: Spot
  /** No layout met every rule (see `layOut`): never so in the tests' sweep. */
  fallback?: boolean
  /**
   * What a puppy walks round on its way to each piece (`pieces` order) and, last, to anywhere
   * else: worked out once per layout.
   */
  walk?: Circle[][][]
}

export interface Circle {
  x: number
  z: number
  r: number
}

export interface StartPlace {
  x: number
  z: number
  heading?: number
}

/**
 * Where each puppy starts with the furniture in `spots` (see `findStarts`). With no furniture,
 * just where they would rather start.
 */
export function startPlaces(cam: FixedCamera, spots: Spots | null, puppies: 1 | 2): StartPlace[] {
  return startPlacesOf(cam, spots, puppies).places
}

/** `startPlaces`, and whether no open floor kept every rule and the wanted places were taken anyway. */
export function startPlacesOf(
  cam: FixedCamera,
  spots: Spots | null,
  puppies: 1 | 2,
): { places: StartPlace[]; fallback: boolean } {
  const local = (s: Spot): Oval => ({
    ...playLocal(cam, s.center.x, s.center.z),
    radius: s.radius,
    depth: s.depth,
  })
  const found = spots
    ? findStarts(
        { beds: spots.beds.map(local), bowls: spots.bowls.map(local), scale: local(spots.scale) },
        local(spots.mud),
        cam,
        puppies,
      )
    : null
  const places = found
    ? found.map((p) => {
        const [x, z] = playWorld(cam, p.d, p.side)
        return { x, z, heading: p.heading }
      })
    : wantedStarts(puppies).map((p, i) => {
        const [x, z] = playWorld(cam, p.d, p.side)
        const want = START_WANT[puppies - 1]![i]
        const heading = want && 'heading' in want ? want.heading : undefined
        return heading == null ? { x, z } : { x, z, heading }
      })
  return { places, fallback: !!spots && !found }
}

export { BEDS, BOWL, BOWL_STEP, SCALE, SLOT_APART } from './layout'

/**
 * The puddle's middle along the view: at the front of the play area, where the puppies starting
 * behind it leave it in sight and the floor in front of them shows the rest of it.
 */
const MUD_D = PLAY.near + 0.15

/**
 * Places each piece for `cam` (see `layOut`): the beds against the house wall, the bowls on their
 * mat in front of them, the scale at the front, every place a puppy stands still at SLOT_APART from
 * the other's. The puddle lies at the front of the grass, and the garden's place to squat behind it.
 */
export function computeSpots(cam: FixedCamera, puppies: 1 | 2): Spots {
  const facing = cam.az
  const placed = (o: Oval): Spot => {
    const [x, z] = playWorld(cam, o.d, o.side)
    return { center: new THREE.Vector3(x, 0, z), radius: o.radius, depth: o.depth, facing }
  }
  const mud = mudPlace(cam, MUD_D)
  const plan = layOut(cam, puppies, mud)
  const spots: Spots = {
    beds: plan.beds.map(placed),
    bowls: plan.bowls.map(placed),
    scale: placed(plan.scale),
    mud: placed(mud),
    garden: placed(pottyPlace(plan, mud, cam)),
    fallback: plan.fallback,
  }
  spots.walk = walkLists(spots)
  return spots
}

export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * How deep in the puddle a point is: 1 in the middle, easing to 0 at 0.9 of its size, inside the
 * wobbly edge drawn around it.
 */
export function inMud(spots: Spots, x: number, z: number): number {
  const { center, radius, depth, facing } = spots.mud
  const rx = x - center.x,
    rz = z - center.z
  const u = (rx * Math.cos(facing) - rz * Math.sin(facing)) / radius,
    v = (rx * Math.sin(facing) + rz * Math.cos(facing)) / depth
  return 1 - smoothstep(0.3, 0.9, Math.hypot(u, v))
}

/** Whether a point is inside `s`'s oval grown by `grow` all round. */
export const inOval = (s: Spot, x: number, z: number, grow: number) => {
  const rx = x - s.center.x,
    rz = z - s.center.z
  const u = (rx * Math.cos(s.facing) - rz * Math.sin(s.facing)) / (s.radius + grow),
    v = (rx * Math.sin(s.facing) + rz * Math.cos(s.facing)) / (s.depth + grow)
  return Math.hypot(u, v) < 1
}

/** What puppies walk around, as circles that hold each oval: the garden is open ground. */
export function furnitureObstacles(spots: Spots): Circle[] {
  return [...spots.beds, ...spots.bowls, spots.scale].map((s) => ({
    x: s.center.x,
    z: s.center.z,
    r: Math.max(s.radius, s.depth),
  }))
}

/** The beds, bowls and scale, in the order `Spots.walk` follows. */
export const pieces = (spots: Spots): Spot[] => [...spots.beds, ...spots.bowls, spots.scale]

/**
 * How close two pieces may stand before a puppy no longer walks between them: it aims 0.3 clear
 * of each rim (`DETOUR`) and is 0.17 wide to each side.
 */
export const WALK_CLEARANCE = 0.3 + 0.17

/**
 * The pieces as one walks round them, in groups: pieces with less than WALK_CLEARANCE between
 * them, as the bowls on their mat, are one group with no way through, however many join up that
 * way. A puppy walks round a group's whole width.
 */
export function walkRound(circles: readonly Circle[]): Circle[][] {
  const group = circles.map((_, i) => i)
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i]!)))
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i]!,
        b = circles[j]!
      if (Math.hypot(b.x - a.x, b.z - a.z) - a.r - b.r < WALK_CLEARANCE) group[root(j)] = root(i)
    }
  const out = new Map<number, Circle[]>()
  circles.forEach((c, i) => {
    const k = root(i)
    out.set(k, [...(out.get(k) ?? []), c])
  })
  return [...out.values()]
}

/** Every piece's walk groups, and last the ones for walking anywhere else. */
function walkLists(spots: Spots): Circle[][][] {
  const all = furnitureObstacles(spots)
  return [...all.map((_, k) => walkRound(all.filter((_, i) => i !== k))), walkRound(all)]
}

/** What a puppy walks round on its way to `to`: every piece but `to`, in groups. */
export function walkingRound(spots: Spots, to: Spot): readonly (readonly Circle[])[] {
  const { beds, bowls } = spots,
    n = beds.length + bowls.length
  const bed = beds.indexOf(to),
    bowl = bowls.indexOf(to)
  const k = bed >= 0 ? bed : bowl >= 0 ? beds.length + bowl : to === spots.scale ? n : n + 1
  const listed = spots.walk?.[k]
  if (listed) return listed
  return walkRound(
    furnitureObstacles(spots).filter((c) => c.x !== to.center.x || c.z !== to.center.z),
  )
}

/** The scale's readout: two decimals with a comma, and blank when nobody is on it. */
export function formatKg(kg: number | null): string {
  if (kg == null) return ''
  return `${Math.max(0, kg).toFixed(2).replace('.', ',')} kg`
}

/** Seconds the scale keeps showing a weight once the puppy has stepped off. */
export const READING_HOLD = 4

/** What the scale shows, and what it last drew and on which furniture. */
export interface ScaleDisplay {
  kg: number | null
  hold: number
  hundredths: number
  on: object | null
}

export const createScaleDisplay = (): ScaleDisplay => ({
  kg: null,
  hold: 0,
  hundredths: 0,
  on: null,
})

/**
 * One frame of the scale's readout: `kg` of the puppy on it, or null with nobody there, when it
 * keeps the last weight READING_HOLD seconds before going blank. It draws only when what
 * it shows changes, so the display's texture is not uploaded every frame.
 */
export function showScale(
  d: ScaleDisplay,
  furniture: Pick<Furniture, 'scaleReading'> | null,
  kg: number | null,
  dt: number,
): void {
  if (kg != null) {
    d.kg = kg
    d.hold = READING_HOLD
  } else if (d.kg != null) {
    d.hold -= dt
    if (d.hold <= 0) d.kg = null
  }
  if (!furniture) return
  const hundredths = Math.round(Math.max(0, d.kg ?? 0) * 100)
  if (d.on === furniture && hundredths === d.hundredths) return
  // Fresh furniture is already blank
  if (d.on !== furniture && !hundredths) {
    d.on = furniture
    d.hundredths = 0
    return
  }
  d.on = furniture
  d.hundredths = hundredths
  furniture.scaleReading(d.kg)
}

export interface Furniture {
  group: THREE.Group
  /** How many puppies it is laid out for: one bed and one bowl each. */
  puppies: 1 | 2
  /** Kept current: `layout` moves and resizes these in place. */
  spots: Spots
  /** Places every piece for the camera's current framing. */
  layout(cam: FixedCamera): void
  /** Shows the bowl at `place` this full, 0 to 1. */
  bowlFill(place: number, level: number): void
  scaleReading(kg: number | null): void
  inMud(x: number, z: number): number
  dispose(): void
}

/** Shows each puppy's bowl as full as the puppy left it: every frame, and so on new furniture too. */
export function showBowls(
  furniture: Pick<Furniture, 'bowlFill'>,
  puppies: readonly { place: number; bowl: number }[],
): void {
  for (const p of puppies) furniture.bowlFill(p.place, p.bowl)
}
