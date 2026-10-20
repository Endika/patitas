import { SPLIT, STRIP_HALF } from './backdrop'
import { fitCamera, PLAY, playAxes, playHalf, type FixedCamera } from './camera'

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
/** How far a bed may lie over the doorway strip: never past it onto the grass. */
export const overStrip = (bed: { radius: number }) =>
  Math.min(BED_OVER_STRIP * bed.radius, 2 * STRIP_HALF)
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
 * Whether two ovals of the same facing stand at least `gap` apart, rim to rim, by the oval of their
 * summed half sizes grown by it. Every centre in that oval is too close, so this never fails two
 * that are far enough apart; for ovals near round it is all but exact, but a long one may pass a
 * little closer (see `clearOf`).
 */
export const apart = (a: Oval, b: Oval, gap: number): boolean =>
  ((a.side - b.side) / (a.radius + b.radius + gap)) ** 2 +
    ((a.d - b.d) / (a.depth + b.depth + gap)) ** 2 >=
  1

const dist = (a: Place, b: Place) => Math.hypot(a.d - b.d, a.side - b.side)

/** Points round the rim measured from, and Newton steps to the nearest point of the other. */
const RIM = 48,
  NEWTON = 6

/**
 * How far a point outside `o` lies from its rim, by Newton's method on the nearest rim angle; 0
 * for a point inside it.
 */
function fromRim(o: Oval, d: number, side: number): number {
  const x = Math.abs(side - o.side),
    y = Math.abs(d - o.d),
    a = o.radius,
    b = o.depth
  if ((x / a) ** 2 + (y / b) ** 2 <= 1) return 0
  let t = Math.atan2(a * y, b * x)
  for (let k = 0; k < NEWTON; k++) {
    const c = Math.cos(t),
      s = Math.sin(t)
    // The slope of the squared distance along the rim, halved, and its own slope
    const f = (a * a - b * b) * s * c - x * a * s + y * b * c,
      df = (a * a - b * b) * (c * c - s * s) - x * a * c - y * b * s
    if (Math.abs(df) < 1e-12) break
    t = Math.min(Math.PI / 2, Math.max(0, t - f / df))
  }
  return Math.hypot(x - a * Math.cos(t), y - b * Math.sin(t))
}

/**
 * Whether two ovals stand at least `gap` apart, rim to rim, however long either is: what `apart`
 * passes is measured from points round `a`'s rim to the nearest of `b`'s.
 */
export function clearOf(a: Oval, b: Oval, gap: number): boolean {
  if (!apart(a, b, gap)) return false
  const reach = Math.max(a.radius, a.depth) + Math.max(b.radius, b.depth)
  if (dist(a, b) - reach >= gap) return true
  for (let i = 0; i < RIM; i++) {
    const t = (i / RIM) * Math.PI * 2
    if (fromRim(b, a.d + a.depth * Math.sin(t), a.side + a.radius * Math.cos(t)) < gap) return false
  }
  return true
}

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
 * The narrowest screen the room is laid out for: on a narrower one, two puppies find no open
 * floor to start on, so it is laid out as for this one. The play area there is at most 0.014
 * narrower, at the back.
 */
export const LAYOUT_ASPECT = 0.33

/** `cam`, or for a screen narrower than LAYOUT_ASPECT the same camera fitted to that. */
function layoutCamera(cam: FixedCamera): FixedCamera {
  const aspect = cam.tanH / Math.tan((cam.fov * Math.PI) / 360)
  return aspect >= LAYOUT_ASPECT - 1e-9
    ? cam
    : fitCamera({ ...cam, target: cam.target.clone() }, LAYOUT_ASPECT)
}

/**
 * Lays the furniture out for `cam` (narrower than LAYOUT_ASPECT, as for that): the beds against the wall, the bowls in front of them, the
 * scale at the front of the house, each piece in turn the most wanted place that keeps every rule
 * with those already placed. Two beds stand side by side where the wall has room; otherwise the
 * second stands in front of the first and further right.
 */
export function layOut(screen: FixedCamera, puppies: 1 | 2, mud: Oval): Layout {
  const cam = layoutCamera(screen)
  const { camD } = playAxes(cam)
  const half = (d: number) => playHalf(cam, d)
  const frame = (d: number) => (camD + d) * cam.tanH
  let first: Layout | null = null,
    crowded: Layout | null = null
  // What holds for the bowls whatever the beds, and the puddle each start hides, worked out once
  const rows = [...bowlRows(puppies, half)].filter((bowls) => bowlsFit(bowls, half))
  const hides = startHider(cam, mud)
  for (const bed of bedSizes(puppies))
    for (const beds of bedRows(bed, puppies, half, frame)) {
      if (!bedsOk(beds, half, frame)) continue
      for (const bowls of rows) {
        if (!bowlsClear(bowls, beds) || bowls.some((b) => !clearOf(b, mud, GAP))) continue
        const scale = scalePlace(beds, bowls, mud, half)
        if (!scale) continue
        const starts = startsOf({ beds, bowls, scale }, mud, cam, puppies, hides)
        // Starts that hide a good part of the puddle: another layout may leave it in sight
        if (starts && starts.hides <= START_HIDES)
          return { beds, bowls, scale, starts: starts.places, fallback: false }
        if (starts) crowded ??= { beds, bowls, scale, starts: starts.places, fallback: false }
        first ??= { beds, bowls, scale, starts: wantedStarts(puppies), fallback: true }
      }
    }
  return (
    crowded ??
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
const bedLeft = (bed: { radius: number }) => HOUSE - overStrip(bed) + bed.radius

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
    if (b.side - b.radius < HOUSE - overStrip(b) - 1e-9) return false
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
 * further forward or back, and last just outside on the grass by the strip, its rim never more
 * than SCALE_BY_GRASS from it. Null when none of those keeps the rules.
 */
function scalePlace(
  beds: Oval[],
  bowls: Oval[],
  mud: Oval,
  half: (d: number) => number,
): Oval | null {
  const at = (d: number, side: number): Oval => ({ d, side, ...SCALE })
  const inside = HOUSE + BY_STRIP + SCALE.radius,
    outside = GRASS - BY_STRIP - SCALE.radius,
    furthest = GRASS - SCALE_BY_GRASS - SCALE.radius
  const depths = [
    SCALE_D,
    ...range(SCALE_D - 0.05, PLAY.near, -0.05),
    ...range(SCALE_D + 0.05, 0.4, 0.05),
  ]
  const own = slotsOf({ beds, bowls, scale: at(0, 0) }).own,
    eaters = bowls.map(eater)
  const ok = (s: Oval) => {
    if (Math.abs(s.side) > half(s.d)) return false
    for (const b of beds) if (!apart(s, b, GAP) || dist(s, b) < KINDS_APART) return false
    for (const [i, b] of bowls.entries())
      if (!apart(s, b, GAP) || dist(s, b) < SCALE_FROM_BOWL || !apart(s, eaters[i]!, EATER_GAP))
        return false
    return slotsApart(own, s) && clearOf(s, mud, GAP)
  }
  for (const d of depths)
    for (const side of range(inside, half(d), 0.02)) if (ok(at(d, side))) return at(d, side)
  for (const d of depths)
    for (const side of range(outside, Math.max(furthest, -half(d)), -0.02))
      if (ok(at(d, side))) return at(d, side)
  return null
}

/** On the grass, the furthest the scale's rim stands from the doorway strip. */
const SCALE_BY_GRASS = 0.1

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
  MUD_CLEAR = 0.1
/** The biggest body, a dorado's, at its start as the camera sees it: half its width, half its length, its height. */
const BODY_BOX = { half: 0.15, length: 0.35, tall: 0.7 }
/** What hiding all of the puddle at the start costs, against the metres from the wanted place. */
const HIDE_COST = 10

/** A start: where, and which way the puppy faces there. */
export interface StartPlace extends Place {
  heading: number
}
/** A start and the share of the puddle it hides. */
interface Start extends StartPlace {
  hides: number
}
const start = ({ d, side, heading }: Start): StartPlace => ({ d, side, heading })

export const wantedStarts = (puppies: 1 | 2): Place[] =>
  START_WANT[puppies - 1]!.map(({ d, side }) => ({ d, side }))

const inside = (o: Oval, p: Place, grow: number) =>
  ((p.side - o.side) / (o.radius + grow)) ** 2 + ((p.d - o.d) / (o.depth + grow)) ** 2 < 1

/** The floor tried for starts: depths and sides in steps of START_STEP. */
const START_D = { from: -0.45, to: 1.2 },
  START_SIDE = { from: -1.5, to: 1.5 },
  START_STEP = 0.05,
  START_ROW = Math.round((START_SIDE.to - START_SIDE.from) / START_STEP) + 1

/** The share of the puddle a start on the grid hides, by heading: what `puddleHider` gives. */
type StartHider = (d: number, side: number, heading: number) => number

/**
 * `puddleHider` for the start grid, each point and heading measured once: it depends on neither
 * the furniture nor the puppies, so a layout shares it between all the furniture it tries.
 */
function startHider(cam: FixedCamera, mud: Oval): StartHider {
  const hidden = puddleHider(cam, mud),
    rows = Math.round((START_D.to - START_D.from) / START_STEP) + 1,
    shares = new Map<number, Float64Array>()
  return (d, side, heading) => {
    let row = shares.get(heading)
    if (!row) shares.set(heading, (row = new Float64Array(rows * START_ROW).fill(NaN)))
    const k =
      Math.round((d - START_D.from) / START_STEP) * START_ROW +
      Math.round((side - START_SIDE.from) / START_STEP)
    if (Number.isNaN(row[k]!)) row[k] = hidden({ d, side }, heading)
    return row[k]!
  }
}

/**
 * Where the puppies start among `pieces`: the open floor nearest START_WANT, clear of every piece
 * and the puddle, SLOT_APART from each other and from every place a puppy stands still at, on the
 * house side if it can and leaving the puddle in sight. Null when there is no such floor. `hides`
 * is the share of the puddle each start hides, for the same camera and puddle.
 */
export function findStarts(
  l: Pick<Layout, 'beds' | 'bowls' | 'scale'>,
  mud: Oval,
  screen: FixedCamera,
  puppies: 1 | 2,
  hides: StartHider = startHider(layoutCamera(screen), mud),
): StartPlace[] | null {
  return startsOf(l, mud, screen, puppies, hides)?.places ?? null
}

/** The share of the puddle the starts may hide between them before another layout is tried. */
const START_HIDES = 0.05

/** `findStarts`, and the share of the puddle the starts hide between them. */
function startsOf(
  l: Pick<Layout, 'beds' | 'bowls' | 'scale'>,
  mud: Oval,
  screen: FixedCamera,
  puppies: 1 | 2,
  hides: StartHider,
): { places: StartPlace[]; hides: number } | null {
  const cam = layoutCamera(screen)
  const half = (d: number) => playHalf(cam, d)
  const want = START_WANT[puppies - 1]!
  const { own, scale } = slotsOf(l)
  const slots = [...own.flat(), scale]
  const all = [...l.beds, ...l.bowls, l.scale]
  const open: Place[] = []
  for (const d of range(START_D.from, START_D.to, START_STEP))
    for (const side of range(START_SIDE.from, START_SIDE.to, START_STEP)) {
      const p = { d, side }
      if (Math.abs(side) > 0.85 * half(d)) continue
      if (all.some((o) => inside(o, p, START_CLEAR)) || inside(mud, p, MUD_CLEAR)) continue
      if (slots.some((q) => dist(p, q) < SLOT_APART)) continue
      open.push(p)
    }
  // Turned as it would rather be, or facing the camera where that hides less of the puddle
  const placed = (p: Place, i: number): Start => {
    const w = want[i]!,
      turned = 'heading' in w ? w.heading : 0
    const share = hides(p.d, p.side, turned),
      facing = hides(p.d, p.side, cam.az)
    return facing < share
      ? { ...p, heading: cam.az, hides: facing }
      : { ...p, heading: turned, hides: share }
  }
  const cost = (p: Start, i: number) =>
    Math.hypot(p.d - want[i]!.d, p.side - want[i]!.side) +
    (p.side < SPLIT ? 0.5 : 0) +
    HIDE_COST * p.hides
  // Cheapest first for each puppy: a pair costs at least its first's cost and the least second's
  const ranked = (i: number) =>
    open
      .map((o) => {
        const p = placed(o, i)
        return { p, c: cost(p, i) }
      })
      .sort((a, b) => a.c - b.c)
  const first = ranked(0)
  if (puppies === 1)
    return first[0] ? { places: [start(first[0].p)], hides: first[0].p.hides } : null
  const second = ranked(1)
  let best: { places: StartPlace[]; hides: number } | null = null,
    least = Infinity
  for (const a of first) {
    if (!second[0] || a.c + second[0].c >= least) break
    for (const b of second) {
      if (a.c + b.c >= least) break
      if (b.p.side <= a.p.side || dist(a.p, b.p) < SLOT_APART) continue
      best = { places: [start(a.p), start(b.p)], hides: a.p.hides + b.p.hides }
      least = a.c + b.c
      break
    }
  }
  return best
}

/**
 * The share of the puddle a puppy standing at a place, turned to `heading`, hides from the
 * camera: points of the puddle that fall inside its body's box on the screen. Seen this low, a
 * body hides the floor well behind it.
 */
function puddleHider(cam: FixedCamera, mud: Oval) {
  const { camD } = playAxes(cam)
  const high = cam.target.y + cam.dist * Math.sin(cam.el),
    c = Math.cos(cam.el),
    s = Math.sin(cam.el)
  // A floor point on the screen, as x then y, written into `at`
  const at = { x: 0, y: 0 }
  const screen = (d: number, side: number, y: number) => {
    const along = camD + d,
      up = y - high,
      z = along * c - up * s
    at.x = side / z
    at.y = (along * s + up * c) / z
  }
  const n = 6 * 24,
    xs = new Float64Array(n),
    ys = new Float64Array(n)
  for (let r = 1, i = 0; r <= 6; r++)
    for (let k = 0; k < 24; k++, i++) {
      const a = (k / 24) * Math.PI * 2
      screen(
        mud.d + (r / 6.5) * Math.sin(a) * mud.depth,
        mud.side + (r / 6.5) * Math.cos(a) * mud.radius,
        0,
      )
      xs[i] = at.x
      ys[i] = at.y
    }
  // The puddle's own box on the screen: a body clear of it hides none of it
  let mx0 = Infinity,
    mx1 = -Infinity,
    my0 = Infinity,
    my1 = -Infinity
  for (let i = 0; i < n; i++) {
    mx0 = Math.min(mx0, xs[i]!)
    mx1 = Math.max(mx1, xs[i]!)
    my0 = Math.min(my0, ys[i]!)
    my1 = Math.max(my1, ys[i]!)
  }
  return (p: Place, heading: number) => {
    const turn = heading - cam.az,
      ws = Math.sin(turn),
      wc = Math.cos(turn)
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity
    for (let corner = 0; corner < 8; corner++) {
      const w = corner & 1 ? BODY_BOX.half : -BODY_BOX.half,
        l = corner & 2 ? BODY_BOX.length : -BODY_BOX.length
      screen(p.d + w * ws - l * wc, p.side + w * wc + l * ws, corner & 4 ? BODY_BOX.tall : 0)
      x0 = Math.min(x0, at.x)
      x1 = Math.max(x1, at.x)
      y0 = Math.min(y0, at.y)
      y1 = Math.max(y1, at.y)
    }
    if (x1 < mx0 || x0 > mx1 || y1 < my0 || y0 > my1) return 0
    let hid = 0
    for (let i = 0; i < n; i++)
      if (xs[i]! >= x0 && xs[i]! <= x1 && ys[i]! >= y0 && ys[i]! <= y1) hid++
    return hid / n
  }
}

/** From the puddle's rim to the doorway strip, and from its middle to the play area's edge. */
const MUD_BY_STRIP = 0.05,
  MUD_IN = 0.06

/**
 * The puddle on the grass at depth `d`: its size grows with the frame, from 0.43 square metres
 * on a tall phone; where the grass is narrow it stretches along the view instead of widening.
 * Its middle stays in the play area, where a puppy can stand in it, and it keeps off the strip.
 */
export function mudPlace(cam: FixedCamera, d: number): Oval {
  const scale = Math.min(0.8, Math.max(0.45, 0.35 * playHalf(cam, 0.8)))
  const want = { radius: 0.69 * scale, depth: 0.99 * scale }
  const area = want.radius * want.depth
  const half = playHalf(cam, d),
    right = GRASS - MUD_BY_STRIP
  const radius = Math.min(want.radius, right + half - MUD_IN)
  return {
    d,
    side: Math.min((GRASS - half) / 2, right - radius),
    radius,
    depth: area / radius,
  }
}

/** Where a puppy squats in the garden: room for one, and how far its rim keeps from the puddle's. */
export const POTTY = { radius: 0.2, depth: 0.2 }
const POTTY_FROM_MUD = 0.3
/** How far into the play area its middle stays, and the depth it would rather be at. */
const POTTY_IN = 0.1,
  POTTY_D = 0.8

/**
 * The place on the grass where a puppy relieves itself: clear of the puddle by POTTY_FROM_MUD and
 * of every piece, the further from the puddle the better (up to a metre), near the middle of the
 * room's depth. Failing that, the grass furthest from the puddle.
 */
export function pottyPlace(
  l: Pick<Layout, 'beds' | 'bowls' | 'scale'>,
  mud: Oval,
  cam: FixedCamera,
): Oval {
  const at = (d: number, side: number): Oval => ({ d, side, ...POTTY })
  const pieces = [...l.beds, ...l.bowls, l.scale]
  let best: Oval | null = null,
    most = -Infinity,
    far: Oval | null = null,
    farthest = -Infinity
  for (const d of range(PLAY.near + POTTY_IN, PLAY.far - POTTY_IN, 0.05))
    for (const side of range(
      GRASS - BY_STRIP - POTTY.radius,
      -playHalf(cam, d) + POTTY_IN,
      -0.05,
    )) {
      const p = at(d, side)
      const away = dist(p, mud)
      if (away > farthest) [far, farthest] = [p, away]
      if (!clearOf(p, mud, POTTY_FROM_MUD)) continue
      if (pieces.some((o) => !clearOf(p, o, GAP))) continue
      if (l.bowls.some((b) => !clearOf(p, eater(b), EATER_GAP))) continue
      const score = Math.min(away, 1) - 0.3 * Math.abs(d - POTTY_D)
      if (score > most) [best, most] = [p, score]
    }
  return best ?? far ?? at(POTTY_D, GRASS - BY_STRIP - POTTY.radius)
}

/** A bowl's mat: how far it reaches across past the middle of its bowls, and along the view. */
export const MAT = { side: 0.18, depth: 0.15 }

/**
 * The bowls' mats in the play area's terms, as rectangles of half sizes: one under both in a row
 * (BOWL_STEP apart at one depth), else one under each; moved off the grass, never narrowed.
 */
export function matsOf(bowls: readonly Oval[]): Oval[] {
  const [a, b] = bowls
  const inRow = !b || (Math.abs(a!.d - b.d) < 1e-6 && Math.abs(dist(a!, b) - BOWL_STEP) < 1e-6)
  const at = (d: number, side: number, across: number): Oval => ({
    d,
    side: Math.max(side, GRASS + across),
    radius: across,
    depth: MAT.depth,
  })
  if (inRow) {
    const d = bowls.reduce((s, o) => s + o.d, 0) / bowls.length,
      side = bowls.reduce((s, o) => s + o.side, 0) / bowls.length
    return [at(d, side, ((bowls.length - 1) * BOWL_STEP) / 2 + MAT.side)]
  }
  return bowls.map((o) => at(o.d, o.side, MAT.side))
}

/** The rug's sizes tried, largest first: its half size across; along the view it is RUG_LONG of that. */
const RUG_SIZES = [0.5, 0.45, 0.4, 0.35, 0.3, 0.26, 0.22, 0.18, 0.15],
  RUG_LONG = 0.7
/** From the rug's rim to every piece and mat, and to the doorway strip. */
const RUG_GAP = 0.06
/** Where it would rather lie: across the middle of the house's floor, at the front, in sight. */
const RUG_D = -0.2
/** It may reach this far in front of the play area, onto the floor the screen shows there. */
const RUG_FRONT = 0.4
/** The share of the screen's half width its rim may reach. */
const RUG_SHOWN = 0.92

/** Whether a point lies in a rectangle of half sizes `radius` across and `depth` along, grown by `grow`. */
const inRect = (o: Oval, d: number, side: number, grow: number) =>
  Math.abs(side - o.side) < o.radius + grow && Math.abs(d - o.d) < o.depth + grow

/**
 * The soft rug in the house: an oval on the open floor, clear by RUG_GAP of the beds, the bowls,
 * their mats and the scale, inside the house and the play area, as big as there is room for and
 * nearest the middle of the house's floor. It is no obstacle: puppies walk and lie on it. Null
 * when even the smallest fits nowhere.
 */
export function rugPlace(
  l: Pick<Layout, 'beds' | 'bowls' | 'scale'>,
  cam: FixedCamera,
): Oval | null {
  const lay = layoutCamera(cam)
  const { camD } = playAxes(lay)
  // What the screen shows across at depth d, a little in from its edge
  const shown = (d: number) => RUG_SHOWN * (camD + d) * lay.tanH
  const half = (d: number) => playHalf(lay, d)
  const pieces = [...l.beds, ...l.bowls, l.scale],
    mats = matsOf(l.bowls)
  const want = { d: RUG_D, side: (HOUSE + half(RUG_D)) / 2 }
  for (const radius of RUG_SIZES) {
    const depth = radius * RUG_LONG
    let best: Oval | null = null,
      nearest = Infinity
    for (const d of range(PLAY.near - RUG_FRONT + depth, PLAY.far - depth, 0.05))
      for (const side of range(HOUSE + RUG_GAP + radius, shown(d) - radius, 0.05)) {
        const rug: Oval = { d, side, radius, depth }
        const far = Math.hypot(d - want.d, side - want.side)
        if (far >= nearest) continue
        // On screen, on the near and far side too
        if (side + radius > shown(d - depth)) continue
        if (pieces.some((o) => !clearOf(rug, o, RUG_GAP))) continue
        if (mats.some((m) => rimIn(rug, m))) continue
        best = rug
        nearest = far
      }
    if (best) return best
  }
  return null
}

/** Whether any point of `rug`'s rim, or its middle, comes within RUG_GAP of the rectangle `m`. */
function rimIn(rug: Oval, m: Oval): boolean {
  if (inRect(m, rug.d, rug.side, RUG_GAP)) return true
  for (let i = 0; i < RIM; i++) {
    const t = (i / RIM) * Math.PI * 2
    if (inRect(m, rug.d + rug.depth * Math.sin(t), rug.side + rug.radius * Math.cos(t), RUG_GAP))
      return true
  }
  // A mat wholly inside the rug
  return ((m.side - rug.side) / rug.radius) ** 2 + ((m.d - rug.d) / rug.depth) ** 2 < 1
}
