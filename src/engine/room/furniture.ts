import * as THREE from 'three'
import { clamp, type Vec3 } from '@/engine/math'
import { SPLIT, STRIP_HALF } from './backdrop'
import { PLAY, playAxes, playHalf, playLocal, playWorld, type FixedCamera } from './camera'

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
 * Where the furniture stands: a bed and a bowl for each puppy, left first, then the scale; `garden`
 * is the grass around the `mud` puddle.
 */
export interface Spots {
  beds: Spot[]
  bowls: Spot[]
  scale: Spot
  mud: Spot
  garden: Spot
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
 * Where one or two puppies would rather start, as depth and side in the play area: near the
 * middle and right of it, so in portrait the puddle on the left is not hidden behind them.
 */
const START_WANT = [
  [{ d: 0.16, side: 0.2 }],
  [
    { d: 0.21, side: 0.07, heading: 0.25 },
    { d: 0.04, side: 0.47, heading: -0.25 },
  ],
] as const
/** How far a start keeps from every piece's oval and the puddle's, and two starts from each other. */
const START_CLEAR = 0.3,
  START_APART = 0.46

/**
 * Where each puppy starts with the furniture in `spots`: the open floor nearest `START_WANT`,
 * clear of every piece and the puddle, on the house side if it can. With no furniture, just there.
 */
export function startPlaces(cam: FixedCamera, spots: Spots | null, puppies: 1 | 2): StartPlace[] {
  const want = START_WANT[puppies - 1]!
  const pieces = spots ? [...spots.beds, ...spots.bowls, spots.scale] : []
  const open: { d: number; side: number }[] = []
  if (spots)
    for (let d = -0.3; d <= 0.6 + 1e-9; d += 0.05)
      for (let side = -0.45; side <= 0.6 + 1e-9; side += 0.05) {
        if (Math.abs(side) > 0.85 * playHalf(cam, d)) continue
        const [x, z] = playWorld(cam, d, side)
        if (pieces.some((p) => inOval(p, x, z, START_CLEAR)) || inOval(spots.mud, x, z, 0.1))
          continue
        open.push({ d, side })
      }
  const cost = (p: { d: number; side: number }, i: number) =>
    Math.hypot(p.d - want[i]!.d, p.side - want[i]!.side) + (p.side < SPLIT ? 0.5 : 0)
  let best: { d: number; side: number }[] | null = null,
    bestCost = Infinity
  if (puppies === 1)
    for (const p of open) {
      if (cost(p, 0) < bestCost) [best, bestCost] = [[p], cost(p, 0)]
    }
  else
    for (const p of open)
      for (const q of open) {
        if (q.side <= p.side || Math.hypot(p.d - q.d, p.side - q.side) < START_APART) continue
        const c = cost(p, 0) + cost(q, 1)
        if (c < bestCost) [best, bestCost] = [[p, q], c]
      }
  return (best ?? want).map((p, i) => {
    const [x, z] = playWorld(cam, p.d, p.side)
    const heading = want[i] && 'heading' in want[i] ? want[i].heading : undefined
    return heading == null ? { x, z } : { x, z, heading }
  })
}

/**
 * One bed holds one puppy; side by side, two beds are a little smaller, and a lone one fits a
 * curled dorado. Its long side faces the screen.
 */
export const BEDS = { alone: { radius: 0.48, depth: 0.39 }, two: { radius: 0.42, depth: 0.34 } },
  BOWL = { radius: 0.13, depth: 0.13 },
  SCALE = { radius: 0.2, depth: 0.16 }

/** The beds' depth in the play area: against the house wall. */
const BED_D = 1.7
/** Centre to centre for beds side by side: a little over 0.1 between their rims. */
const BED_STEP = 2 * BEDS.two.radius + 0.11
/** Between two beds one behind the other, measured on their ovals grown by half of it each. */
const BED_GAP = 0.12
/** How much of a bed's radius may lie over the doorway strip; none of it on the grass. */
const BED_OVER_STRIP = 0.15
/**
 * Bowls sit wider apart than their rims need: two puppies eating side by side stay outside each
 * other's personal space (0.45), so neither is pushed off its bowl.
 */
export const BOWL_STEP = 0.47
/** The bowls' depth, when no bed is in the way of the puppies eating there. */
const BOWL_D = 0.62
/**
 * A puppy eating stands behind its bowl, as the camera sees it: its muzzle (0.36 at most) and its
 * rump (0.32) reach this far back, and this far to each side.
 */
const EATER = { back: 0.69, half: 0.17 }
/** The scale's depth, at the front of the house, when the bowls leave room for it. */
const SCALE_D = -0.4
/** From the doorway strip to the rim of a piece set just inside the house. */
const BY_STRIP = 0.02
/** How far a curled sleeper reaches across its bed, ears and all, and towards the camera. */
const SLEEPER = { reach: 0.45, ahead: 0.3 }
/** The share of the screen's half width a sleeper may reach. */
const SLEEPER_EDGE = 0.93

/** The garden as drawn, before `layout` stretches it to the frame. */
export const GARDEN = { radius: 0.315, depth: 0.45 }
/** The garden's width over its depth. */
const GARDEN_WIDTH = 0.7
/** The puddle within the garden, in fractions of its half sizes: towards the front, a little to the left. */
export const MUD = { u: -0.12, v: 0.35, size: 0.55 }

/** The house side of the doorway strip, as a side in the play area. */
const HOUSE = SPLIT + STRIP_HALF

/** Centre to centre from the scale to a bowl, outside a puppy's personal space. */
const SCALE_FROM_BOWL = 0.47

/**
 * The scale at the front of the house just inside it, or as far right as the bowls need. With
 * the bowls right across the front of a narrow house, it stands just outside on the grass instead,
 * where a puppy can walk round to it: between two bowls there is no way through.
 */
function scalePlace(cam: FixedCamera, bowlD: number, bowlSides: number[]) {
  const d = Math.max(PLAY.near, Math.min(SCALE_D, bowlD - BOWL.depth - 0.1 - SCALE.depth))
  const half = playHalf(cam, d)
  const clear = (side: number) =>
    bowlSides.every((s) => Math.hypot(d - bowlD, side - s) >= SCALE_FROM_BOWL)
  const inside = HOUSE + BY_STRIP + SCALE.radius
  for (let side = inside; side <= half; side += 0.01) if (clear(side)) return { d, side }
  for (let side = SPLIT - STRIP_HALF - BY_STRIP - SCALE.radius; side >= -half; side -= 0.01)
    if (clear(side)) return { d, side }
  return { d, side: inside }
}

/**
 * Places each piece in the house, right of the doorway strip, so it stays in frame for every
 * aspect: the beds against the wall, the bowls on their mat in front of them, the scale at the
 * front. Two beds stand side by side where the wall has room for them; otherwise the second
 * stands in front of the first and further right, the bowls come forward to stay clear of it and
 * the scale steps out onto the grass by the strip (see `scalePlace`). The garden runs along the
 * left edge with its puddle.
 */
export function computeSpots(cam: FixedCamera, puppies: 1 | 2): Spots {
  const facing = cam.az
  const at = (d: number, side: number, size: { radius: number; depth: number }): Spot => {
    const [x, z] = playWorld(cam, d, side)
    return { center: new THREE.Vector3(x, 0, z), ...size, facing }
  }
  const spot = (d: number, side: number, size: { radius: number; depth: number }): Spot =>
    at(d, side * playHalf(cam, d), size)
  const { camD } = playAxes(cam)
  const bed = puppies === 1 ? BEDS.alone : BEDS.two
  const leftmost = HOUSE - BED_OVER_STRIP * bed.radius + bed.radius
  // On a narrow screen the beds come in from the edge so the sleepers in them stay in frame
  const rightmost = (d: number) =>
    Math.min(
      playHalf(cam, d),
      SLEEPER_EDGE * (camD + d - SLEEPER.ahead) * cam.tanH - Math.max(SLEEPER.reach, bed.radius),
    )
  const want = 0.55 * playHalf(cam, BED_D) - ((puppies - 1) * BED_STEP) / 2
  const first = clamp(
    want,
    leftmost,
    Math.max(leftmost, rightmost(BED_D) - (puppies - 1) * BED_STEP),
  )
  const beds = [at(BED_D, first, bed)]
  if (puppies === 2) {
    if (first + BED_STEP <= rightmost(BED_D)) beds.push(at(BED_D, first + BED_STEP, bed))
    else {
      // As deep as it goes clear of the first, as far right as its sleeper stays in frame
      const across = 2 * bed.radius + BED_GAP,
        along = 2 * bed.depth + BED_GAP
      let d = BED_D - along
      for (let i = 0; i < 8; i++) {
        const off = Math.min(1, Math.max(0, rightmost(d) - first) / across)
        d = BED_D - along * Math.sqrt(1 - off * off)
      }
      beds.push(at(d, Math.max(first, rightmost(d)), bed))
    }
  }
  // The bowls start just inside the house; one eating must not stand in a bed
  const bowlSides = (d: number) => {
    const left = HOUSE + BY_STRIP + BOWL.radius,
      over = Math.max(0, left + (puppies - 1) * BOWL_STEP - playHalf(cam, d))
    return Array.from({ length: puppies }, (_, i) => left - over + i * BOWL_STEP)
  }
  let bowlD = BOWL_D
  for (let pass = 0; pass < 2; pass++)
    for (const b of beds) {
      const { d, side } = playLocal(cam, b.center.x, b.center.z)
      if (bowlSides(bowlD).some((s) => Math.abs(s - side) < b.radius + EATER.half))
        bowlD = Math.min(bowlD, d - b.depth - EATER.back)
    }
  const bowls = bowlSides(bowlD).map((side) => at(bowlD, side, BOWL))
  const scaleAt = scalePlace(cam, bowlD, bowlSides(bowlD))
  const gd = 0.8,
    depth = clamp(0.35 * playHalf(cam, gd), 0.45, 0.8)
  const garden = spot(gd, -0.9, { radius: GARDEN_WIDTH * depth, depth })
  // Across the screen is +x turned by the azimuth, towards the camera is +z turned by it
  const cx = Math.cos(facing),
    sz = Math.sin(facing),
    u = MUD.u * garden.radius,
    v = MUD.v * garden.depth
  const mud: Spot = {
    center: new THREE.Vector3(
      garden.center.x + u * cx + v * sz,
      0,
      garden.center.z - u * sz + v * cx,
    ),
    radius: MUD.size * garden.radius,
    depth: MUD.size * garden.depth,
    facing,
  }
  return {
    beds,
    bowls,
    scale: at(scaleAt.d, scaleAt.side, SCALE),
    mud,
    garden,
  }
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
