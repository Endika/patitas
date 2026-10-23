import type { Decor, FoodId } from '@/domain/shop'
import * as THREE from 'three'
import { clamp, type Vec3 } from '@/engine/math'
import { playLocal, playWorld, type FixedCamera } from './camera'
import {
  findStarts,
  layOut,
  mudPlace,
  pottyPlace,
  rugPlace,
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
  /** The soft rug on the house floor, clear of every piece and mat; none where there is no room. */
  rug: Spot | null
  /** No layout met every rule (see `layOut`): never so in the tests' sweep. */
  fallback?: boolean
  /** Where each puppy starts, as the layout found it with the furniture (see `startPlaces`). */
  starts?: StartPlace[]
  /**
   * What a puppy walks round on its way to each piece (`pieces` order) and, last, to anywhere
   * else: worked out once per layout.
   */
  walk?: Circle[][][]
  /** `walk` with the scale put away. */
  walkBare?: Circle[][][]
  /** The scale is put away until a puppy is weighed: nobody walks round its place. */
  scaleAway?: boolean
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
  // Laid out with the furniture already, for as many
  if (spots?.starts?.length === puppies && !spots.fallback)
    return { places: spots.starts, fallback: false }
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
 * Places each piece for `cam` (see `layOut`): the beds against the house wall, the bowls on their
 * mat in front of them, the scale at the front, every place a puppy stands still at SLOT_APART from
 * the other's. The puddle lies at the back of the grass, and the garden's place to squat in front of it.
 */
export function computeSpots(cam: FixedCamera, puppies: 1 | 2): Spots {
  const facing = cam.az
  const placed = (o: Oval): Spot => {
    const [x, z] = playWorld(cam, o.d, o.side)
    return { center: new THREE.Vector3(x, 0, z), radius: o.radius, depth: o.depth, facing }
  }
  const mud = mudPlace(cam)
  const plan = layOut(cam, puppies, mud),
    rugAt = rugPlace(plan, cam)
  const spots: Spots = {
    beds: plan.beds.map(placed),
    bowls: plan.bowls.map(placed),
    scale: placed(plan.scale),
    mud: placed(mud),
    garden: placed(pottyPlace(plan, mud, cam)),
    rug: rugAt ? placed(rugAt) : null,
    fallback: plan.fallback,
    starts: plan.starts.map((p) => {
      const [x, z] = playWorld(cam, p.d, p.side)
      return 'heading' in p ? { x, z, heading: p.heading as number } : { x, z }
    }),
  }
  spots.walk = walkLists(spots)
  spots.walkBare = walkLists(spots, [pieces(spots).indexOf(spots.scale)])
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

/** How far a standing puppy keeps from a piece's edge or the puddle: about a body's half width. */
const OPEN_CLEAR = 0.22
/** A point the clamp moves further than this is off the play area. */
const OFF_PLAY = 1e-3
const AROUND = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [
  Math.sin((i * Math.PI) / 4),
  Math.cos((i * Math.PI) / 4),
])

/** Whether a puppy has room to stand at (x, z): in play, clear of every piece and the puddle. */
export function openAt(
  spots: Spots,
  clamp: (x: number, z: number) => [number, number],
  x: number,
  z: number,
): boolean {
  const [cx, cz] = clamp(x, z)
  if (Math.abs(cx - x) > OFF_PLAY || Math.abs(cz - z) > OFF_PLAY) return false
  for (const bed of spots.beds) if (!clearOf(bed, x, z)) return false
  for (const bowl of spots.bowls) if (!clearOf(bowl, x, z)) return false
  return clearOf(spots.scale, x, z) && !nearMud(spots, x, z, OPEN_CLEAR)
}

const clearOf = ({ center, radius, depth }: Spot, x: number, z: number) =>
  Math.hypot(x - center.x, z - center.z) >= Math.max(radius, depth) + OPEN_CLEAR

/** Whether (x, z) lies in the puddle or within `margin` of its edge. */
export function nearMud(spots: Spots, x: number, z: number, margin: number): boolean {
  if (inMud(spots, x, z) > 0) return true
  for (const [dx, dz] of AROUND)
    if (inMud(spots, x + dx! * margin, z + dz! * margin) > 0) return true
  return false
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

/**
 * Every piece's walk groups, and last the ones for walking anywhere else, leaving out the pieces
 * at the indices in `out` (as `pieces` orders them) besides the one walked to.
 */
function walkLists(spots: Spots, out: number[] = []): Circle[][][] {
  const all = furnitureObstacles(spots),
    kept = (k: number) => all.filter((_, i) => i !== k && !out.includes(i))
  return [...all.map((_, k) => walkRound(kept(k))), walkRound(kept(-1))]
}

/** What a puppy walks round on its way to `to`: every piece but `to`, leaving out the scale too while it is put away, in groups. */
export function walkingRound(spots: Spots, to: Spot): readonly (readonly Circle[])[] {
  const { beds, bowls, scale } = spots,
    n = beds.length + bowls.length
  const bed = beds.indexOf(to),
    bowl = bowls.indexOf(to)
  const k = bed >= 0 ? bed : bowl >= 0 ? beds.length + bowl : to === scale ? n : n + 1
  const listed = (spots.scaleAway ? spots.walkBare : spots.walk)?.[k]
  if (listed) return listed
  return walkRound(
    furnitureObstacles(spots).filter(
      (c, i) => (c.x !== to.center.x || c.z !== to.center.z) && !(spots.scaleAway && i === n),
    ),
  )
}

/** The scale's readout: two decimals with a comma, and blank when nobody is on it. */
export function formatKg(kg: number | null): string {
  if (kg == null) return ''
  return `${Math.max(0, kg).toFixed(2).replace('.', ',')} kg`
}

/** Seconds the scale keeps showing a weight once the puppy has stepped off. */
export const READING_HOLD = 4

/** Seconds the scale takes to come out, and to go away again. */
export const SCALE_POP = 0.25

/** What the scale shows, how far out it is, and what it last drew and on which furniture. */
export interface ScaleDisplay {
  kg: number | null
  hold: number
  /** 0 put away to 1 out. */
  out: number
  hundredths: number
  on: object | null
}

export const createScaleDisplay = (): ScaleDisplay => ({
  kg: null,
  hold: 0,
  out: 0,
  hundredths: 0,
  on: null,
})

/**
 * One frame of the scale: `kg` of the puppy on it, or null with nobody there, when it keeps the
 * last weight READING_HOLD seconds before going blank. It comes out while a puppy is `weighing`
 * and stays while it reads, then goes away, SCALE_POP seconds either way. The readout draws only
 * when what it shows changes, so the display's texture is not uploaded every frame.
 */
export function showScale(
  d: ScaleDisplay,
  furniture: Pick<Furniture, 'scaleReading' | 'scaleOut'> | null,
  kg: number | null,
  weighing: boolean,
  dt: number,
): void {
  if (kg != null) {
    d.kg = kg
    d.hold = READING_HOLD
  } else if (d.kg != null) {
    d.hold -= dt
    if (d.hold <= 0) d.kg = null
  }
  const step = dt / SCALE_POP
  d.out = weighing || d.kg != null ? Math.min(1, d.out + step) : Math.max(0, d.out - step)
  if (!furniture) return
  furniture.scaleOut(d.out)
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
  /** Places every piece for the camera's current framing, or as `spots` (laid out for it) say. */
  layout(cam: FixedCamera, spots?: Spots): void
  /** How full the bowl at `place` is, 0 to 1, and with which special food, if any. */
  bowlFill(place: number, level: number, food: FoodId | null): void
  /** Paints the beds, the bowls and the rug in the colours chosen in the shop. */
  setDecor(decor: Decor): void
  scaleReading(kg: number | null): void
  /** Shows the scale `t` of the way out, 0 put away to 1 out. */
  scaleOut(t: number): void
  inMud(x: number, z: number): number
  dispose(): void
}

/** Shows each puppy's bowl as full as the puppy left it: every frame, and so on new furniture too. */
export function showBowls(
  furniture: Pick<Furniture, 'bowlFill'>,
  puppies: readonly { place: number; bowl: number; food: FoodId | null }[],
): void {
  for (const p of puppies) furniture.bowlFill(p.place, p.bowl, p.food)
}
