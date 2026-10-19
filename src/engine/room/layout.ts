import { SPLIT, STRIP_HALF } from './backdrop'
import { PLAY, playAxes, playHalf, type FixedCamera } from './camera'

/** A piece's oval in the play area's own terms: `d` along the view from the target, `side` across. */
export interface Oval {
  d: number
  side: number
  /** Half size across the screen. */
  radius: number
  /** Half size along the view. */
  depth: number
}

/** A point in the play area's own terms. */
export interface Place {
  d: number
  side: number
}

export interface Layout {
  beds: Oval[]
  bowls: Oval[]
  scale: Oval
  /** Where each puppy starts. */
  starts: Place[]
  /** No candidate met every rule and this is the first one anyway: a bug, which the tests catch. */
  fallback: boolean
}

/**
 * One bed holds one puppy; side by side, two beds are a little smaller, and a lone one fits a
 * curled dorado. Its long side faces the screen.
 */
export const BEDS = { alone: { radius: 0.48, depth: 0.39 }, two: { radius: 0.42, depth: 0.34 } },
  BOWL = { radius: 0.13, depth: 0.13 },
  SCALE = { radius: 0.2, depth: 0.16 }

/**
 * Between any two places two puppies may stand at once (each one's bowl, bed and start, and the
 * scale): two bodies side by side need 0.444 (beagles), and 0.08 more keeps them from shoving.
 */
export const SLOT_APART = 0.53
/** Bowls side by side, so the two eating there stand SLOT_APART apart. */
export const BOWL_STEP = SLOT_APART
/**
 * How far behind its bowl a puppy eating stands, as the camera sees it: the breeds' muzzles
 * (`reach` × 0.7) are 0.335 to 0.356.
 */
export const EAT_REACH = 0.35
/** The body of one eating, round where it stands: its rump reaches 0.32 back, its flanks 0.17. */
const EATER = { radius: 0.17, depth: 0.32 }

/** The beds' depth in the play area: against the house wall. */
const BED_D = 1.7
/** Centre to centre for beds side by side: a little over 0.1 between their rims. */
const BED_STEP = 2 * BEDS.two.radius + 0.11
/** How much of a bed's radius may lie over the doorway strip; none of it on the grass. */
const BED_OVER_STRIP = 0.15
/** How far a curled sleeper reaches across its bed, ears and all, and towards the camera. */
const SLEEPER = { reach: 0.45, ahead: 0.3 }
/** How far a sleeper's head lies from its bed's middle, along its heading (bodies.ts: 0.41). */
const SLEEPER_HEAD = 0.41
/**
 * How far two sleepers turn off facing the camera, each to its own side: side by side a little,
 * so neither hides the other; the one at the back of two one behind the other well round to the
 * left, its head away from the bed in front.
 */
export const SLEEP_TURN = { beside: 0.25, behind: 0.9 }
/** The share of the screen's half width a sleeper may reach. */
const SLEEPER_EDGE = 0.93
/** The bowls' depth, when nothing in the room needs them elsewhere. */
const BOWL_D = 0.62
/** The scale's depth, at the front of the house, when the bowls leave room for it. */
const SCALE_D = -0.4
/** From the doorway strip to the rim of a piece set just inside the house. */
const BY_STRIP = 0.02
/** Between the rims of any two pieces, and between one eating and anything but its bowl. */
const GAP = 0.1,
  EATER_GAP = 0.05
/** Centre to centre for pieces of different kinds; a bowl and the scale may stand a little closer. */
const KINDS_APART = 0.5,
  SCALE_FROM_BOWL = 0.47

/** The house side of the doorway strip, and the grass's edge, as sides in the play area. */
export const HOUSE = SPLIT + STRIP_HALF,
  GRASS = SPLIT - STRIP_HALF

/**
 * Whether two ovals of the same facing stand at least `gap` apart, rim to rim: each grown by half
 * of it is held in the oval of their summed half sizes, so this never passes two that are closer.
 */
export const apart = (a: Oval, b: Oval, gap: number): boolean =>
  ((a.side - b.side) / (a.radius + b.radius + gap)) ** 2 +
    ((a.d - b.d) / (a.depth + b.depth + gap)) ** 2 >=
  1

const dist = (a: Place, b: Place) => Math.hypot(a.d - b.d, a.side - b.side)
const range = (from: number, to: number, step: number) => {
  const out: number[] = []
  for (let v = from; step > 0 ? v <= to + 1e-9 : v >= to - 1e-9; v += step) out.push(v)
  return out
}

/** Where a puppy eats from `bowl`, and the body it stands in there. */
export const eatPlace = (bowl: Place): Place => ({ d: bowl.d + EAT_REACH, side: bowl.side })
const eater = (bowl: Place): Oval => ({ ...eatPlace(bowl), ...EATER })

/** Every place a puppy stands still at in this layout, puppy by puppy, then the scale. */
export function slotsOf(l: Pick<Layout, 'beds' | 'bowls' | 'scale'>): {
  own: Place[][]
  scale: Place
} {
  return {
    own: l.beds.map((bed, i) => [bed, eatPlace(l.bowls[i]!)]),
    scale: l.scale,
  }
}

/**
 * Lays the furniture out for `cam`: the beds against the wall, the bowls in front of them, the
 * scale at the front of the house, each piece in turn the most wanted place that keeps every rule
 * with those already placed. Two beds stand side by side where the wall has room; otherwise the
 * second stands in front of the first and further right.
 */
export function layOut(cam: FixedCamera, puppies: 1 | 2, mud: Oval): Layout {
  const { camD } = playAxes(cam)
  const half = (d: number) => playHalf(cam, d)
  const frame = (d: number) => (camD + d) * cam.tanH
  let first: Layout | null = null
  // What holds for the bowls whatever the beds, worked out once
  const rows = [...bowlRows(puppies, half)].filter((bowls) => bowlsFit(bowls, half))
  for (const bed of bedSizes(puppies))
    for (const beds of bedRows(bed, puppies, half, frame)) {
      if (!bedsOk(beds, half, frame)) continue
      for (const bowls of rows) {
        if (!bowlsClear(bowls, beds)) continue
        const scale = scalePlace(beds, bowls, half)
        if (!scale) continue
        const starts = findStarts({ beds, bowls, scale }, mud, cam, puppies)
        if (starts) return { beds, bowls, scale, starts, fallback: false }
        first ??= { beds, bowls, scale, starts: wantedStarts(puppies), fallback: true }
      }
    }
  return (
    first ?? {
      beds: [...bedRows(bedSizes(puppies)[0]!, puppies, half, frame)][0]!,
      bowls: rows[0] ?? [...bowlRows(puppies, half)][0]!,
      scale: { d: SCALE_D, side: 0, ...SCALE },
      starts: wantedStarts(puppies),
      fallback: true,
    }
  )
}

/**
 * A curled dorado's body, tail and all, reaches 0.27 across from its bed's middle, its head turned
 * outwards aside (measured on a night shot of two in 0.42 beds); the bolster's top is 0.05 inside
 * a bed's rim. So no bed for two gets narrower than this.
 */
export const DORADO_BED = 0.27 + 0.05

/** The beds' sizes to try, largest first: two may shrink while a curled dorado still fits. */
function bedSizes(puppies: 1 | 2) {
  if (puppies === 1) return [BEDS.alone]
  const sizes = []
  for (let r = BEDS.two.radius; r >= DORADO_BED - 1e-9; r -= 0.02)
    sizes.push({ radius: r, depth: (r * BEDS.two.depth) / BEDS.two.radius })
  return sizes
}

/** The rightmost side a bed's centre may take at depth `d`, its sleeper still in frame. */
const bedRight = (
  bed: { radius: number },
  d: number,
  half: (d: number) => number,
  frame: (d: number) => number,
) =>
  Math.min(half(d), SLEEPER_EDGE * frame(d - SLEEPER.ahead) - Math.max(SLEEPER.reach, bed.radius))
const bedLeft = (bed: { radius: number }) => HOUSE - BED_OVER_STRIP * bed.radius + bed.radius

/** Where the beds may go, the most wanted first. */
function* bedRows(
  bed: { radius: number; depth: number },
  puppies: 1 | 2,
  half: (d: number) => number,
  frame: (d: number) => number,
): Generator<Oval[]> {
  const left = bedLeft(bed),
    right = bedRight(bed, BED_D, half, frame)
  const want = 0.55 * half(BED_D) - ((puppies - 1) * BED_STEP) / 2
  const at = (d: number, side: number): Oval => ({ d, side, ...bed })
  if (puppies === 1) {
    const s = Math.min(Math.max(want, left), right)
    yield [at(BED_D, s)]
    for (const s2 of range(left, right, 0.05)) yield [at(BED_D, s2)]
    return
  }
  if (left + BED_STEP <= right) {
    const s = Math.min(Math.max(want, left), right - BED_STEP)
    yield [at(BED_D, s), at(BED_D, s + BED_STEP)]
  }
  // One in front of the other: as deep as it goes, as far right as its sleeper stays in frame
  for (const s0 of [left, left + 0.05, left + 0.1])
    for (const d of range(BED_D - 0.3, 0.2, -0.05)) {
      const s1 = bedRight(bed, d, half, frame)
      if (s1 < s0) continue
      for (const s of [s1, s1 - 0.05, s1 - 0.1]) if (s >= s0) yield [at(BED_D, s0), at(d, s)]
    }
}

function bedsOk(beds: Oval[], half: (d: number) => number, frame: (d: number) => number) {
  for (const b of beds) {
    if (b.side - b.radius < HOUSE - BED_OVER_STRIP * b.radius - 1e-9) return false
    if (b.side > bedRight(b, b.d, half, frame) + 1e-9) return false
    if (b.side - Math.max(SLEEPER.reach, b.radius) < -SLEEPER_EDGE * frame(b.d - SLEEPER.ahead))
      return false
  }
  if (beds.length === 2) {
    const [a, b] = beds as [Oval, Oval]
    if (!apart(a, b, GAP) || dist(a, b) < SLOT_APART) return false
    // One behind the other, the sleeper at the back turns its head away from the bed in front
    if (Math.abs(a.d - b.d) > 1e-9) {
      const turn = SLEEP_TURN.behind
      const head = {
        d: a.d - SLEEPER_HEAD * Math.cos(turn),
        side: a.side - SLEEPER_HEAD * Math.sin(turn),
      }
      if (dist(b, head) < SLOT_APART) return false
    }
  }
  return true
}

/** Where the bowls may go, the most wanted first: in a row just inside the house, the row coming forward, then two apart in depth. */
function* bowlRows(puppies: 1 | 2, half: (d: number) => number): Generator<Oval[]> {
  const at = (d: number, side: number): Oval => ({ d, side, ...BOWL })
  const inside = HOUSE + BY_STRIP + BOWL.radius,
    edge = GRASS + BOWL.radius + 0.005
  for (const d of range(BOWL_D, PLAY.near + 0.1, -0.05)) {
    const sides = [
      inside,
      ...range(inside + 0.05, half(d), 0.05),
      ...range(inside - 0.04, edge, -0.04),
      edge,
    ]
    for (const s of sides) {
      if (puppies === 1) yield [at(d, s)]
      else yield [at(d, s), at(d, s + BOWL_STEP)]
    }
  }
  if (puppies === 1) return
  // Two in depth: the second further forward and to the right, out of the first one's way
  for (const d of range(BOWL_D, PLAY.near + 0.6, -0.05))
    for (const back of [0.6, 0.75, 0.9])
      for (const s of [inside, edge, inside + 0.1])
        for (const over of [0.2, 0.3, 0.4]) yield [at(d, s), at(d - back, s + over)]
}

/** The bowls in play, off the grass and clear of each other, the puppies eating there too. */
function bowlsFit(bowls: Oval[], half: (d: number) => number) {
  for (const [i, b] of bowls.entries()) {
    if (b.d < PLAY.near || b.d > PLAY.far || Math.abs(b.side) > half(b.d)) return false
    if (b.side - b.radius < GRASS) return false
    const eat = eater(b)
    if (eat.d > PLAY.far || Math.abs(eat.side) > half(eat.d)) return false
    for (const [j, o] of bowls.entries())
      if (j !== i && (!apart(b, o, GAP) || !apart(eat, o, EATER_GAP))) return false
  }
  return bowls.length < 2 || dist(eatPlace(bowls[0]!), eatPlace(bowls[1]!)) >= SLOT_APART
}

/** The bowls, and the puppies eating there, clear of the beds and of the other's bed. */
function bowlsClear(bowls: Oval[], beds: Oval[]) {
  for (const [i, b] of bowls.entries()) {
    const eat = eater(b)
    for (const [j, bed] of beds.entries()) {
      if (!apart(b, bed, GAP) || dist(b, bed) < KINDS_APART || !apart(eat, bed, EATER_GAP))
        return false
      if (j !== i && dist(eat, bed) < SLOT_APART) return false
    }
  }
  return true
}

/** Whether every place of one puppy stands SLOT_APART from every place of the other. */
function slotsApart(own: Place[][], scale?: Place) {
  for (let i = 0; i < own.length; i++) {
    for (let j = i + 1; j < own.length; j++)
      for (const a of own[i]!) for (const b of own[j]!) if (dist(a, b) < SLOT_APART) return false
    if (scale && own.length > 1)
      for (const a of own[i]!) if (dist(a, scale) < SLOT_APART) return false
  }
  return true
}

/**
 * The scale at the front of the house just inside it, or as far right as it must; failing that
 * further forward or back, and last just outside on the grass by the strip.
 */
function scalePlace(beds: Oval[], bowls: Oval[], half: (d: number) => number): Oval | null {
  const at = (d: number, side: number): Oval => ({ d, side, ...SCALE })
  const inside = HOUSE + BY_STRIP + SCALE.radius,
    outside = GRASS - BY_STRIP - SCALE.radius
  const depths = [
    SCALE_D,
    ...range(SCALE_D - 0.05, PLAY.near, -0.05),
    ...range(SCALE_D + 0.05, 0.4, 0.05),
  ]
  const own = slotsOf({ beds, bowls, scale: at(0, 0) }).own
  const ok = (s: Oval) => {
    if (Math.abs(s.side) > half(s.d)) return false
    for (const b of beds) if (!apart(s, b, GAP) || dist(s, b) < KINDS_APART) return false
    for (const b of bowls)
      if (!apart(s, b, GAP) || dist(s, b) < SCALE_FROM_BOWL || !apart(s, eater(b), EATER_GAP))
        return false
    return slotsApart(own, s)
  }
  for (const d of depths)
    for (const side of range(inside, half(d), 0.02)) if (ok(at(d, side))) return at(d, side)
  for (const d of depths)
    for (const side of range(outside, -half(d), -0.02)) if (ok(at(d, side))) return at(d, side)
  return null
}

/**
 * Where one or two puppies would rather start: near the middle and right of it, so in portrait
 * the puddle on the left is not hidden behind them.
 */
export const START_WANT = [
  [{ d: 0.16, side: 0.2 }],
  [
    { d: 0.21, side: 0.07, heading: 0.25 },
    { d: 0.04, side: 0.47, heading: -0.25 },
  ],
] as const
/** How far a start keeps from every piece's oval, and from the puddle's. */
const START_CLEAR = 0.3,
  MUD_CLEAR = 0.1,
  /** Half a puppy's length, and its width seen from the camera turned a little as it starts. */
  MUD_HIDE = 0.3

export const wantedStarts = (puppies: 1 | 2): Place[] =>
  START_WANT[puppies - 1]!.map(({ d, side }) => ({ d, side }))

const inside = (o: Oval, p: Place, grow: number) =>
  ((p.side - o.side) / (o.radius + grow)) ** 2 + ((p.d - o.d) / (o.depth + grow)) ** 2 < 1

/**
 * Where the puppies start among `pieces`: the open floor nearest START_WANT, clear of every piece
 * and the puddle, SLOT_APART from each other and from every place a puppy stands still at, on the
 * house side if it can. Null when there is no such floor.
 */
export function findStarts(
  l: Pick<Layout, 'beds' | 'bowls' | 'scale'>,
  mud: Oval,
  cam: FixedCamera,
  puppies: 1 | 2,
): Place[] | null {
  const half = (d: number) => playHalf(cam, d),
    { camD } = playAxes(cam)
  const want = START_WANT[puppies - 1]!
  const { own, scale } = slotsOf(l)
  const slots = [...own.flat(), scale]
  const all = [...l.beds, ...l.bowls, l.scale]
  const open: Place[] = []
  for (const d of range(-0.45, 1.2, 0.05))
    for (const side of range(-1.5, 1.5, 0.05)) {
      const p = { d, side }
      if (Math.abs(side) > 0.85 * half(d)) continue
      if (all.some((o) => inside(o, p, START_CLEAR)) || inside(mud, p, MUD_CLEAR)) continue
      if (slots.some((q) => dist(p, q) < SLOT_APART)) continue
      open.push(p)
    }
  // In front of the puddle, it hides it from the player: across the screen, a body nearer the
  // camera covers what lies behind it within its width, seen from there
  const across = (o: Place) => o.side / (camD + o.d)
  const hides = (p: Place) =>
    p.d - MUD_HIDE < mud.d + mud.depth &&
    Math.abs(across(p) - across(mud)) < mud.radius / (camD + mud.d) + MUD_HIDE / (camD + p.d)
  const cost = (p: Place, i: number) =>
    Math.hypot(p.d - want[i]!.d, p.side - want[i]!.side) +
    (p.side < SPLIT ? 0.5 : 0) +
    (hides(p) ? 2 : 0)
  // Cheapest first for each puppy: a pair costs at least its first's cost and the least second's
  const ranked = (i: number) => open.map((p) => ({ p, c: cost(p, i) })).sort((a, b) => a.c - b.c)
  const first = ranked(0)
  if (puppies === 1) return first[0] ? [first[0].p] : null
  const second = ranked(1)
  let best: Place[] | null = null,
    least = Infinity
  for (const a of first) {
    if (!second[0] || a.c + second[0].c >= least) break
    for (const b of second) {
      if (a.c + b.c >= least) break
      if (b.p.side <= a.p.side || dist(a.p, b.p) < SLOT_APART) continue
      ;[best, least] = [[a.p, b.p], a.c + b.c]
      break
    }
  }
  return best
}
