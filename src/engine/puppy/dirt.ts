import { messPenalty, soil, type Care } from '@/domain/care'
import type { Vec3 } from '@/engine/math'
import type { Wallow } from '@/engine/motion/routine'
import { inMud, type Spots } from '@/engine/room/furniture'
import { vnoise } from './noise'

/**
 * Where mud can reach on a breed's mesh, worked out once from its rest pose: how readily the
 * paws, the belly and the tip of the muzzle take it, and the back and the flanks rolling in it,
 * and the order it settles in by height.
 */
export interface DirtRest {
  position: ArrayLike<number>
  paw: Float32Array
  belly: Float32Array
  muzzle: Float32Array
  back: Float32Array
  flank: Float32Array
  /** 0 takes dirt first, 1 last: what `redistributeDirt` spreads a level by. */
  order: Float32Array
  /** The vertices mud reaches at all, so soiling skips the rest. */
  reach: Uint32Array
}

/** A puppy's own dirt, one value 0 to 1 per vertex, and the time since it was last soiled. */
export interface Dirt {
  field: Float32Array
  rest: DirtRest
  acc: number
}

/** Seconds between soiling steps: at most 10 a second, and so as many uploads. */
export const DIRT_STEP = 0.1

/** Dirt per second at full depth on a vertex that takes it fully. */
const PAW_RATE = 0.4,
  BELLY_RATE = 0.1,
  MUZZLE_RATE = 0.06
/** Rolling, the back and the flanks take it too; digging, the paws, belly and muzzle faster. */
const ROLL_RATE = { back: 0.3, flank: 0.35, belly: 0.3 },
  DIG_TIMES = 2.5
/** Rest heights: the paws, and the belly underneath. */
const PAW_TOP = { from: 0.09, to: 0.15 },
  BELLY_TOP = { from: 0.24, to: 0.32 }
/** How far the top of the mud wanders up and down round the leg. */
const RAGGED = 0.06
/** Around the nose, the fur that dips into the mud. */
const MUZZLE_R = { from: 0.06, to: 0.1 }
/** Scrubbing takes off this share of what brushing does. */
const BRUSH_SHARE = 0.3
/** How soft the line between dirty and clean is when a level is spread by height. */
const SPREAD = 0.25

const sm = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function createDirtField(vertexCount: number): Float32Array {
  return new Float32Array(vertexCount)
}

/** From the shared mesh's rest positions and normals, and where its nose is. */
export function dirtRest(
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  nose: readonly number[],
): DirtRest {
  const n = Math.floor(position.length / 3)
  const paw = new Float32Array(n),
    belly = new Float32Array(n),
    muzzle = new Float32Array(n),
    back = new Float32Array(n),
    flank = new Float32Array(n),
    order = new Float32Array(n)
  let top = 1e-6
  for (let i = 0; i < n; i++) top = Math.max(top, position[i * 3 + 1]!)
  const reach: number[] = []
  for (let i = 0; i < n; i++) {
    const x = position[i * 3]!,
      y = position[i * 3 + 1]!,
      z = position[i * 3 + 2]!
    // Mud lands in splotches, not evenly
    const patchy = 0.6 + 0.8 * vnoise(x * 22 + 3.1, y * 22, z * 22)
    // A ragged line where it stops, not a sock
    const edge = RAGGED * (vnoise(x * 14 + 7.3, y * 14, z * 14) - 0.5)
    paw[i] = (1 - sm(PAW_TOP.from + edge, PAW_TOP.to + edge, y)) * patchy
    belly[i] =
      (1 - sm(BELLY_TOP.from + edge, BELLY_TOP.to + edge, y)) *
      sm(0.3, 0.8, -normal[i * 3 + 1]!) *
      patchy
    muzzle[i] =
      (1 - sm(MUZZLE_R.from, MUZZLE_R.to, Math.hypot(x - nose[0]!, y - nose[1]!, z - nose[2]!))) *
      patchy
    // Rolled on, the fur facing up and to the sides above the legs
    const above = sm(BELLY_TOP.from + edge, BELLY_TOP.to + edge, y)
    back[i] = above * sm(0.2, 0.7, normal[i * 3 + 1]!) * patchy
    flank[i] = above * sm(0.4, 0.85, Math.abs(normal[i * 3]!)) * patchy
    order[i] = Math.min(
      1 - Math.min(1, paw[i]!),
      1 - 0.7 * Math.min(1, belly[i]!),
      1 - 0.45 * Math.min(1, muzzle[i]!),
      0.25 + 0.75 * Math.max(0, y / top),
    )
    if (paw[i]! > 0 || belly[i]! > 0 || muzzle[i]! > 0 || back[i]! > 0 || flank[i]! > 0)
      reach.push(i)
  }
  return { position, paw, belly, muzzle, back, flank, order, reach: Uint32Array.from(reach) }
}

export const createDirt = (rest: DirtRest): Dirt => ({
  field: createDirtField(rest.paw.length),
  rest,
  acc: 0,
})

/**
 * `dt` seconds standing in mud `depth` deep (0 to 1, as `inMud` gives it). The paws take it at any
 * depth, the belly from about a third of the way in and the tip of the muzzle only near the
 * middle, each slower than the one before: the longer and deeper, the higher it climbs. Rolling
 * in it soils the back and the flanks as well, and digging soils the paws, belly and muzzle
 * DIG_TIMES as fast. Returns whether anything changed.
 */
export function soilFromMud(
  field: Float32Array,
  rest: DirtRest,
  depth: number,
  dt: number,
  wallow: Wallow | null = null,
): boolean {
  if (depth <= 0 || dt <= 0) return false
  const dig = wallow === 'dig' ? DIG_TIMES : 1,
    roll = wallow === 'roll' ? depth * dt : 0
  const kp = PAW_RATE * Math.min(1, depth / 0.3) * dt * dig,
    kb = BELLY_RATE * sm(0.3, 0.8, depth) * dt * dig + ROLL_RATE.belly * roll,
    km = MUZZLE_RATE * sm(0.6, 1, depth) * dt * dig,
    kk = ROLL_RATE.back * roll,
    kf = ROLL_RATE.flank * roll
  let changed = false
  for (const i of rest.reach) {
    const was = field[i]!
    if (was >= 1) continue
    const add =
      kp * rest.paw[i]! +
      kb * rest.belly[i]! +
      km * rest.muzzle[i]! +
      kk * rest.back[i]! +
      kf * rest.flank[i]!
    if (add <= 0) continue
    field[i] = Math.min(1, was + add)
    changed = true
  }
  return changed
}

/**
 * Takes off up to `amount` of dirt within `radius` of `point` (rest pose), the most at the
 * middle and none from the edge out. Returns whether anything changed.
 */
export function scrubAt(
  field: Float32Array,
  rest: DirtRest,
  point: Pick<Vec3, 'x' | 'y' | 'z'>,
  radius: number,
  amount: number,
): boolean {
  const p = rest.position,
    r2 = radius * radius
  let changed = false
  for (let i = 0; i < field.length; i++) {
    if (field[i]! <= 0) continue
    const dx = p[i * 3]! - point.x,
      dy = p[i * 3 + 1]! - point.y,
      dz = p[i * 3 + 2]! - point.z,
      d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= r2) continue
    const w = 1 - d2 / r2
    field[i] = Math.max(0, field[i]! - amount * w * w)
    changed = true
  }
  return changed
}

/** Brushing knocks off some of the dry dirt: like scrubbing, but far less. */
export const brushAt = (
  field: Float32Array,
  rest: DirtRest,
  point: Pick<Vec3, 'x' | 'y' | 'z'>,
  radius: number,
  amount: number,
): boolean => scrubAt(field, rest, point, radius, amount * BRUSH_SHARE)

export function meanDirt(field: Float32Array): number {
  if (!field.length) return 0
  let s = 0
  for (let i = 0; i < field.length; i++) s += field[i]!
  return s / field.length
}

/**
 * The care with its cleanliness at 1 − the mean dirt, less what the waiting messes take: the field
 * is the truth while the room is open, and its change lands on the care through `soil` like any
 * other.
 */
export const withDirt = (care: Care, field: Float32Array): Care =>
  soil(care, care.cleanliness - (1 - meanDirt(field) - messPenalty(care)))

/**
 * Spreads a saved level of dirt (its mean) over the puppy by height, paws first, then belly,
 * muzzle and up the body: only the level is kept between visits.
 */
export function redistributeDirt(field: Float32Array, rest: DirtRest, level: number): void {
  const { order } = rest
  const fill = (cut: number) => {
    let s = 0
    for (let i = 0; i < field.length; i++) {
      const v = Math.min(1, Math.max(0, (cut - order[i]!) / SPREAD))
      field[i] = v
      s += v
    }
    return field.length ? s / field.length : 0
  }
  level = Math.min(1, Math.max(0, level))
  let lo = 0,
    hi = 1 + SPREAD
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2
    if (fill(mid) < level) lo = mid
    else hi = mid
  }
  fill(level >= 1 ? 1 + SPREAD : level <= 0 ? 0 : (lo + hi) / 2)
}

/**
 * One frame for a puppy whose body stands at `depth` in the mud, rolling or digging in it or not:
 * soils it every DIRT_STEP while it is in, so the field (and its upload) changes at most 10 times a
 * second. Returns whether it changed.
 */
export function stepDirt(
  d: Dirt,
  depth: number,
  dt: number,
  wallow: Wallow | null = null,
): boolean {
  if (depth <= 0) {
    d.acc = 0
    return false
  }
  d.acc += dt
  if (d.acc < DIRT_STEP) return false
  const t = d.acc
  d.acc = 0
  return soilFromMud(d.field, d.rest, depth, t, wallow)
}

/** How deep in the puddle a puppy stands: its body or the deepest of its paws. */
export function mudDepth(
  spots: Spots,
  body: Pick<Vec3, 'x' | 'z'>,
  legs: readonly { pos: Pick<Vec3, 'x' | 'z'> }[],
): number {
  let d = inMud(spots, body.x, body.z)
  for (const { pos } of legs) d = Math.max(d, inMud(spots, pos.x, pos.z))
  return d
}

/** A mess on the floor as the paws meet it, in world coordinates. */
export interface Underfoot {
  x: number
  z: number
  r: number
}

/** Deep enough for the paws and no further. */
const MESS_DEPTH = 0.3

/** Stepping in a mess: as deep as mud that only reaches the paws, while any paw is in one. */
export function messDepth(
  messes: readonly Underfoot[],
  legs: readonly { pos: Pick<Vec3, 'x' | 'z'> }[],
): number {
  for (const m of messes)
    for (const { pos } of legs) if (Math.hypot(pos.x - m.x, pos.z - m.z) < m.r) return MESS_DEPTH
  return 0
}
