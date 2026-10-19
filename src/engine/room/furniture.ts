import * as THREE from 'three'
import { clamp, type Vec3 } from '@/engine/math'
import { playAxes, playHalf, playWorld, type FixedCamera } from './camera'

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

/**
 * Where each puppy starts, for one or two: right of the middle, so in portrait the puddle on the
 * left is not hidden behind the left one.
 */
export const START_PLACES: readonly (readonly { x: number; z: number; heading?: number }[])[] = [
  [{ x: 0.12, z: -0.12 }],
  [
    { x: -0.02, z: -0.12, heading: 0.25 },
    { x: 0.42, z: -0.12, heading: -0.25 },
  ],
]

/**
 * One bed holds one puppy; side by side, two beds are a little smaller, and a lone one fits a
 * curled dorado. Its long side faces the screen.
 */
const BEDS = { alone: { radius: 0.48, depth: 0.39 }, two: { radius: 0.42, depth: 0.34 } },
  BOWL = { radius: 0.13, depth: 0.13 },
  SCALE = { radius: 0.2, depth: 0.16 }

/** The beds' depth in the play area. */
const BED_D = 1.7
/** Centre to centre for beds side by side: a little over 0.1 between their rims. */
const BED_STEP = 2 * BEDS.two.radius + 0.11
/**
 * Bowls sit wider apart than their rims need: two puppies eating side by side stay outside each
 * other's personal space (0.45), so neither is pushed off its bowl.
 */
const BOWL_STEP = 0.47
/** The scale's depth when there is no room for it beside the bowls. */
const SCALE_BACK_D = 0.8
/** With two, the scale stays in front only with the right-hand bowl this far left of the middle. */
const EATER_CLEAR = 0.3
/** How far a curled sleeper reaches across its bed, ears and all, and towards the camera. */
const SLEEPER = { reach: 0.45, ahead: 0.3 }
/** The share of the screen's half width a sleeper may reach. */
const SLEEPER_EDGE = 0.93

/** The garden as drawn, before `layout` stretches it to the frame. */
const GARDEN = { radius: 0.315, depth: 0.45 }
/** The garden's width over its depth. */
const GARDEN_WIDTH = 0.7
/** The puddle within the garden, in fractions of its half sizes: towards the front, a little to the left. */
const MUD = { u: -0.12, v: 0.35, size: 0.55 }

/**
 * Sides for `n` pieces `step` apart around `want`, the row kept within `limit` of the middle.
 */
const row = (n: number, step: number, want: number, limit: number) => {
  const ext = ((n - 1) * step) / 2
  const mid = clamp(want, Math.min(0, ext - limit), Math.max(0, limit - ext))
  return Array.from({ length: n }, (_, i) => mid - ext + i * step)
}

/**
 * Places each piece at a depth and a fraction of the play area's half width there, so it stays in
 * frame for every aspect. The bowls and scale sit ahead of where the puppies start, the beds at
 * the back, and the garden runs along the left edge with its puddle beside the puppies. Each
 * puppy has a bed and a bowl, side by side.
 */
export function computeSpots(cam: FixedCamera, puppies: 1 | 2): Spots {
  const facing = cam.az
  const at = (d: number, side: number, size: { radius: number; depth: number }): Spot => {
    const [x, z] = playWorld(cam, d, side)
    return { center: new THREE.Vector3(x, 0, z), ...size, facing }
  }
  const spot = (d: number, side: number, size: { radius: number; depth: number }): Spot =>
    at(d, side * playHalf(cam, d), size)
  // On a narrow screen the beds come in from the edge so the sleepers in them stay in frame
  const frustumHalf = (playAxes(cam).camD + BED_D - SLEEPER.ahead) * cam.tanH
  const bed = puppies === 1 ? BEDS.alone : BEDS.two
  const beds = row(
    puppies,
    BED_STEP,
    0.55 * playHalf(cam, BED_D),
    SLEEPER_EDGE * frustumHalf - Math.max(SLEEPER.reach, bed.radius),
  ).map((side) => at(BED_D, side, bed))
  const bowlD = -0.48,
    half = playHalf(cam, bowlD)
  const bowlSides = row(puppies, BOWL_STEP, -0.8 * half, 0.95 * half)
  // The scale steps right when two bowls reach towards it; when they leave it no room in front,
  // as on a narrow screen, it goes further back on the right, across from the garden. So it does
  // with a second bowl near the middle: a puppy going to be weighed would pass behind it and
  // shove the one eating there
  const scaleOff = BOWL.radius + 0.125 + SCALE.radius
  const last = bowlSides.at(-1)!,
    nextTo = last + scaleOff
  const scaleAt =
    nextTo <= 0.95 * half && (puppies === 1 || last <= -EATER_CLEAR)
      ? { d: bowlD, side: Math.max(0.8 * half, nextTo) }
      : { d: SCALE_BACK_D, side: 0.8 * playHalf(cam, SCALE_BACK_D) }
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
    bowls: bowlSides.map((side) => at(bowlD, side, BOWL)),
    scale: at(scaleAt.d, scaleAt.side, SCALE),
    mud,
    garden,
  }
}

const smoothstep = (a: number, b: number, v: number) => {
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

/** What puppies walk around, as circles that hold each oval: the garden is open ground. */
export function furnitureObstacles(spots: Spots): Circle[] {
  return [...spots.beds, ...spots.bowls, spots.scale].map((s) => ({
    x: s.center.x,
    z: s.center.z,
    r: Math.max(s.radius, s.depth),
  }))
}

/** The scale's readout: one decimal with a comma, and blank when nobody is on it. */
export function formatKg(kg: number | null): string {
  if (kg == null) return ''
  return `${Math.max(0, kg).toFixed(1).replace('.', ',')} kg`
}

/** Seconds the scale keeps showing a weight once the puppy has stepped off. */
export const READING_HOLD = 4

/** What the scale shows, and what it last drew and on which furniture. */
export interface ScaleDisplay {
  kg: number | null
  hold: number
  tenths: number
  on: object | null
}

export const createScaleDisplay = (): ScaleDisplay => ({ kg: null, hold: 0, tenths: 0, on: null })

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
  const tenths = Math.round(Math.max(0, d.kg ?? 0) * 10)
  if (d.on === furniture && tenths === d.tenths) return
  // Fresh furniture is already blank
  if (d.on !== furniture && !tenths) {
    d.on = furniture
    d.tenths = 0
    return
  }
  d.on = furniture
  d.tenths = tenths
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

const INK = '#22302e'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A soft irregular outline: 1 ± a few percent around the circle. */
const wobble = (a: number, k: number, seed: number) =>
  1 +
  k *
    (0.6 * Math.sin(3 * a + seed) +
      0.3 * Math.sin(5 * a + seed * 1.7) +
      0.2 * Math.sin(9 * a + seed * 2.3))

/** A soft dark round fading out to nothing, for the shade right under a piece. */
function contactTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, '#fff')
  gr.addColorStop(0.55, '#aaa')
  gr.addColorStop(1, '#000')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/**
 * Grounds a piece wherever the sun's shadow box, which follows the puppies, leaves it out: `rx`
 * and `rz` are the piece's half sizes.
 */
function contact(alphaMap: THREE.Texture, rx: number, rz: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      color: '#3b2a1c',
      alphaMap,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  )
  m.rotation.x = -Math.PI / 2
  m.scale.set(rx * 1.15, rz * 1.15, 1)
  m.position.y = 0.001
  return m
}

function bed(shade: THREE.Texture, { radius, depth }: Spot): THREE.Group {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius - 0.09, 0.09, 18, 64),
    new THREE.MeshStandardMaterial({ color: '#d77d69', roughness: 0.95 }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.scale.set(1, 0.82, 0.78)
  ring.position.y = 0.09 * 0.78
  ring.castShadow = ring.receiveShadow = true
  const pad = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 12),
    new THREE.MeshStandardMaterial({ color: '#f3d9cb', roughness: 1 }),
  )
  pad.scale.set(radius - 0.1, 0.04, 0.8 * (radius - 0.1))
  pad.position.y = 0.025
  pad.receiveShadow = true
  g.add(ring, pad, contact(shade, radius, depth, 0.35))
  return g
}

export const KIBBLE = 110

export function bowl(shade: THREE.Texture): { group: THREE.Group; kibble: THREE.InstancedMesh } {
  const g = new THREE.Group()
  const profile = [
    [0, 0],
    [0.095, 0],
    [0.112, 0.006],
    [0.124, 0.024],
    [0.128, 0.05],
    [0.124, 0.066],
    [0.114, 0.072],
    [0.104, 0.067],
    [0.097, 0.05],
    [0.086, 0.028],
    [0.068, 0.016],
    [0, 0.014],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const dish = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 48),
    new THREE.MeshStandardMaterial({ color: INK, roughness: 0.32 }),
  )
  dish.receiveShadow = true
  const kibble = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.016, 5, 3),
    new THREE.MeshStandardMaterial({ roughness: 0.75 }),
    KIBBLE,
  )
  // A dome of pellets, lowest first, so a partial fill is a lower mound
  const rand = rng(7)
  const pellets: { x: number; y: number; z: number }[] = []
  while (pellets.length < KIBBLE) {
    const r = Math.sqrt(rand()) * 0.07,
      a = rand() * Math.PI * 2
    const top = 0.054 * (1 - (r / 0.078) ** 2)
    pellets.push({ x: r * Math.cos(a), y: 0.02 + rand() * top, z: r * Math.sin(a) })
  }
  pellets.sort((p, q) => p.y - q.y)
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    sc = new THREE.Vector3(),
    c = new THREE.Color()
  pellets.forEach((p, i) => {
    e.set(rand() * 6, rand() * 6, rand() * 6)
    sc.set(1, 0.7, 0.9).multiplyScalar(0.85 + rand() * 0.3)
    kibble.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromEuler(e), sc))
    kibble.setColorAt(i, c.set('#8b5a32').offsetHSL(0, 0, (rand() - 0.5) * 0.12))
  })
  // Three caches the sphere on the first draw; bowlFill(…, 0) would leave it empty and cull the kibble for good
  kibble.computeBoundingSphere()
  g.add(dish, kibble, contact(shade, BOWL.radius, BOWL.depth, 0.45))
  return { group: g, kibble }
}

function scale(shade: THREE.Texture): {
  group: THREE.Group
  screen: HTMLCanvasElement
  map: THREE.CanvasTexture
} {
  const g = new THREE.Group()
  // An oval platform with a rounded edge, a soft mat on top and a pill for the display
  const edge = [
    [0, 0],
    [0.17, 0],
    [0.192, 0.006],
    [0.2, 0.02],
    [0.196, 0.033],
    [0.184, 0.04],
    [0, 0.04],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(edge, 48),
    new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.5 }),
  )
  body.scale.z = 0.8
  body.castShadow = body.receiveShadow = true
  const mat = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 40),
    new THREE.MeshStandardMaterial({ color: '#9fbfae', roughness: 0.85 }),
  )
  mat.rotation.x = -Math.PI / 2
  mat.scale.y = 0.6
  mat.position.set(0, 0.0405, -0.03)
  mat.receiveShadow = true
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 12),
    new THREE.MeshStandardMaterial({ color: '#e6e1d4', roughness: 0.5 }),
  )
  head.scale.set(0.12, 0.04, 0.03)
  head.position.set(0, 0.04, 0.12)
  head.castShadow = true
  const screen = document.createElement('canvas')
  screen.width = 240
  screen.height = 80
  const map = new THREE.CanvasTexture(screen)
  map.colorSpace = THREE.SRGBColorSpace
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.073),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }),
  )
  display.position.set(0, 0.055, 0.157)
  display.rotation.x = -0.35
  g.add(body, mat, head, display, contact(shade, SCALE.radius, SCALE.depth, 0.35))
  return { group: g, screen, map }
}

function drawReading(screen: HTMLCanvasElement, text: string) {
  const g = screen.getContext('2d')
  if (!g) return
  // With nobody on it the display is off, a pale screen rather than a dark one
  g.fillStyle = text ? INK : '#b9c7c1'
  g.fillRect(0, 0, screen.width, screen.height)
  g.fillStyle = '#cdeedb'
  g.font = '700 62px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, screen.width / 2, screen.height / 2 + 2)
}

/**
 * An irregular oval with vertex colours: half sizes `rx` across and `rz` along the view, its rim
 * `rim(a)` times those and its height `y(t)` from the middle out.
 */
function blob(
  rx: number,
  rz: number,
  rim: (a: number) => number,
  y: (t: number) => number,
  color: (t: number, a: number, out: THREE.Color) => THREE.Color,
  alpha: (t: number) => number,
): THREE.BufferGeometry {
  const rings = 10,
    segs = 64
  const pos: number[] = [0, y(0), 0],
    col: number[] = []
  const c = new THREE.Color()
  color(0, 0, c)
  col.push(c.r, c.g, c.b, alpha(0))
  for (let i = 1; i <= rings; i++) {
    const t = i / rings
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2,
        k = t * rim(a)
      pos.push(k * rx * Math.cos(a), y(t), -k * rz * Math.sin(a))
      color(t, a, c)
      col.push(c.r, c.g, c.b, alpha(t))
    }
  }
  const idx: number[] = []
  for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs))
  for (let i = 1; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = 1 + (i - 1) * segs + j,
        b = 1 + (i - 1) * segs + ((j + 1) % segs),
        c2 = a + segs,
        d = b + segs
      idx.push(a, c2, b, b, c2, d)
    }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

const BLADES = 900

/** One tapered blade: two crossed triangles, so it shows from any side. */
function bladeGeometry(): THREE.BufferGeometry {
  const w = 0.0055,
    h = 0.038
  const geo = new THREE.BufferGeometry()
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0, h, 0, 0, 0, -w, 0, 0, w, 0, h, 0], 3),
  )
  // Lit like the ground under it, so the blades read as soft grass rather than facets
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array(6).fill([0, 1, 0]).flat(), 3))
  return geo
}

function garden(): THREE.Group {
  const g = new THREE.Group()
  const grassRim = (a: number) => wobble(a, 0.09, 1.3)
  const mudRim = (a: number) => wobble(a, 0.08, 4.1)
  const light = new THREE.Color('#8fb35e'),
    dark = new THREE.Color('#5f8a43')
  const grass = new THREE.Mesh(
    blob(
      GARDEN.radius,
      GARDEN.depth,
      grassRim,
      () => 0.002,
      (t, a, out) => {
        const x = t * Math.cos(a) * 9,
          z = t * Math.sin(a) * 9
        return out
          .copy(dark)
          .lerp(light, 0.55 + 0.25 * Math.sin(x + 1.3 * z) * Math.cos(1.7 * x - z))
      },
      (t) => 1 - smoothstep(0.78, 1, t),
    ),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      transparent: true,
      depthWrite: false,
    }),
  )
  grass.receiveShadow = true
  grass.renderOrder = 1
  const wetEdge = new THREE.Color('#5a3b22'),
    deep = new THREE.Color('#3a2312')
  const mudR = MUD.size * GARDEN.radius,
    mudD = MUD.size * GARDEN.depth
  const mud = new THREE.Mesh(
    blob(
      mudR,
      mudD,
      mudRim,
      (t) => -0.008 * (1 - t * t) + 0.004 * smoothstep(0.85, 1, t),
      (t, _a, out) => out.copy(deep).lerp(wetEdge, smoothstep(0.55, 1, t)),
      () => 1,
    ),
    // Drawn after the see-through grass, which writes no depth, so the sunken middle shows.
    // Damp rather than glossy: seen this low, the rim light glances off it from behind and any
    // ordinary shine turns the puddle grey, so its specular is nearly off
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.6,
      specularIntensity: 0.03,
      envMapIntensity: 0.25,
      transparent: true,
    }),
  )
  mud.position.set(MUD.u * GARDEN.radius, 0.003, MUD.v * GARDEN.depth)
  mud.receiveShadow = true
  mud.renderOrder = 2
  // Short blades on the grass, thinning towards its edge and none in the puddle
  const blades = new THREE.InstancedMesh(
    bladeGeometry(),
    new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }),
    BLADES,
  )
  const rand = rng(11)
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    s = new THREE.Vector3(),
    p = new THREE.Vector3(),
    c = new THREE.Color()
  let n = 0
  while (n < BLADES) {
    const a = rand() * Math.PI * 2,
      t = Math.sqrt(rand())
    if (t > 0.92 && rand() < 0.6) continue
    const k = t * grassRim(a) * 0.95
    p.set(k * GARDEN.radius * Math.cos(a), 0, -k * GARDEN.depth * Math.sin(a))
    const mu = (p.x - mud.position.x) / mudR,
      mv = (p.z - mud.position.z) / mudD
    if (Math.hypot(mu, mv) < mudRim(Math.atan2(-mv, mu)) * 1.08) continue
    e.set((rand() - 0.5) * 0.7, rand() * 6, (rand() - 0.5) * 0.7)
    s.set(1, 0.6 + rand() * 0.8 * (1 - 0.5 * t), 1)
    blades.setMatrixAt(n, m.compose(p, q.setFromEuler(e), s))
    blades.setColorAt(n, c.copy(dark).lerp(light, rand()).offsetHSL(0, 0, 0.04))
    n++
  }
  g.add(grass, mud, blades)
  return g
}

/** A bed and a bowl for each of `puppies`, the scale and the garden corner, laid out for `cam`. */
export function addFurniture(scene: THREE.Scene, cam: FixedCamera, puppies: 1 | 2): Furniture {
  const group = new THREE.Group()
  const shade = contactTexture()
  const spots = computeSpots(cam, puppies)
  const beds = spots.beds.map((s) => bed(shade, s)),
    bowls = spots.bowls.map(() => bowl(shade)),
    scaleParts = scale(shade),
    gardenG = garden()
  group.add(...beds, ...bowls.map((b) => b.group), scaleParts.group, gardenG)
  scene.add(group)

  const placed: [THREE.Object3D, Spot][] = [
    ...beds.map((b, i): [THREE.Object3D, Spot] => [b, spots.beds[i]!]),
    ...bowls.map((b, i): [THREE.Object3D, Spot] => [b.group, spots.bowls[i]!]),
    [scaleParts.group, spots.scale],
    [gardenG, spots.garden],
  ]
  const update = (spot: Spot, fresh: Spot) => {
    const { center, ...size } = fresh
    Object.assign(spot, size).center.copy(center)
  }
  const furniture: Furniture = {
    group,
    puppies,
    spots,
    layout(next) {
      const fresh = computeSpots(next, puppies)
      fresh.beds.forEach((s, i) => update(spots.beds[i]!, s))
      fresh.bowls.forEach((s, i) => update(spots.bowls[i]!, s))
      for (const k of ['scale', 'mud', 'garden'] as const) update(spots[k], fresh[k])
      // Everything faces the camera, so the bed's long side and the scale's display face the screen
      for (const [o, s] of placed) {
        o.position.copy(s.center)
        o.rotation.y = next.az
      }
      gardenG.scale.set(spots.garden.radius / GARDEN.radius, 1, spots.garden.depth / GARDEN.depth)
    },
    bowlFill(place, level) {
      const parts = bowls[place]
      if (parts) parts.kibble.count = Math.round(clamp(level, 0, 1) * KIBBLE)
    },
    scaleReading(kg) {
      drawReading(scaleParts.screen, formatKg(kg))
      scaleParts.map.needsUpdate = true
    },
    inMud: (x, z) => inMud(spots, x, z),
    dispose() {
      scene.remove(group)
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        if (o instanceof THREE.InstancedMesh) o.dispose()
        o.geometry.dispose()
        const mat = o.material as THREE.MeshStandardMaterial
        mat.map?.dispose()
        mat.alphaMap?.dispose()
        mat.dispose()
      })
    },
  }
  furniture.layout(cam)
  // Empty until someone fills them
  bowls.forEach((_, i) => furniture.bowlFill(i, 0))
  furniture.scaleReading(null)
  return furniture
}
