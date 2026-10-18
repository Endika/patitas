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

/** Where the furniture stands; `garden` is the grass around the `mud` puddle. */
export interface Spots {
  bed: Spot
  bowl: Spot
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

/** The bed's ring is 0.6 across its long side, which faces the screen. */
const BED = { radius: 0.6, depth: 0.47 },
  BOWL = { radius: 0.13, depth: 0.13 },
  SCALE = { radius: 0.2, depth: 0.16 }

/** The bed's depth in the play area. */
const BED_D = 1.6
/** How far past the bed's rim two curled sleepers reach, plus a margin to the screen edge. */
const BED_OVERHANG = 0.2

/** The garden as drawn, before `layout` stretches it to the frame. */
const GARDEN = { radius: 0.315, depth: 0.45 }
/** The garden's width over its depth. */
const GARDEN_WIDTH = 0.7
/** The puddle within the garden, in fractions of its half sizes: towards the front, a little to the left. */
const MUD = { u: -0.12, v: 0.35, size: 0.55 }

/**
 * Places each piece at a depth and a fraction of the play area's half width there, so it stays in
 * frame for every aspect. The bowl and scale sit ahead of where the puppies start, the bed at the
 * back, and the garden runs along the left edge with its puddle beside the puppies.
 */
export function computeSpots(cam: FixedCamera): Spots {
  const facing = cam.az
  const at = (d: number, side: number, size: { radius: number; depth: number }): Spot => {
    const [x, z] = playWorld(cam, d, side)
    return { center: new THREE.Vector3(x, 0, z), ...size, facing }
  }
  const spot = (d: number, side: number, size: { radius: number; depth: number }): Spot =>
    at(d, side * playHalf(cam, d), size)
  // On a narrow screen the bed comes in from the edge so the sleepers in it stay in frame
  const frustumHalf = (playAxes(cam).camD + BED_D) * cam.tanH
  const bedSide = Math.min(0.55 * playHalf(cam, BED_D), frustumHalf - BED.radius - BED_OVERHANG)
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
    bed: at(BED_D, bedSide, BED),
    bowl: spot(-0.48, -0.8, BOWL),
    scale: spot(-0.48, 0.8, SCALE),
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
  return [spots.bed, spots.bowl, spots.scale].map((s) => ({
    x: s.center.x,
    z: s.center.z,
    r: Math.max(s.radius, s.depth),
  }))
}

/** The scale's readout: one decimal with a comma, and zero when nobody is on it. */
export function formatKg(kg: number | null): string {
  return `${Math.max(0, kg ?? 0)
    .toFixed(1)
    .replace('.', ',')} kg`
}

export interface Furniture {
  group: THREE.Group
  /** Kept current: `layout` moves and resizes these in place. */
  spots: Spots
  /** Places every piece for the camera's current framing. */
  layout(cam: FixedCamera): void
  /** How full the bowl is, 0 to 1. */
  bowlFill(level: number): void
  scaleReading(kg: number | null): void
  inMud(x: number, z: number): number
  dispose(): void
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

function bed(shade: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.49, 0.11, 18, 64),
    new THREE.MeshStandardMaterial({ color: '#d77d69', roughness: 0.95 }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.scale.set(1, 0.82, 0.78)
  ring.position.y = 0.11 * 0.78
  ring.castShadow = ring.receiveShadow = true
  const pad = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 12),
    new THREE.MeshStandardMaterial({ color: '#f3d9cb', roughness: 1 }),
  )
  pad.scale.set(0.42, 0.04, 0.34)
  pad.position.y = 0.025
  pad.receiveShadow = true
  g.add(ring, pad, contact(shade, BED.radius, BED.depth, 0.35))
  return g
}

const KIBBLE = 110

function bowl(shade: THREE.Texture): { group: THREE.Group; kibble: THREE.InstancedMesh } {
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
    new THREE.SphereGeometry(0.011, 5, 3),
    new THREE.MeshStandardMaterial({ roughness: 0.75 }),
    KIBBLE,
  )
  // A dome of pellets, lowest first, so a partial fill is a lower mound
  const rand = rng(7)
  const pellets: { x: number; y: number; z: number }[] = []
  while (pellets.length < KIBBLE) {
    const r = Math.sqrt(rand()) * 0.078,
      a = rand() * Math.PI * 2
    const top = 0.05 * (1 - (r / 0.085) ** 2)
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
    new THREE.PlaneGeometry(0.18, 0.06),
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
  g.fillStyle = INK
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

/** The bed, the bowl, the scale and the garden corner, laid out for `cam`. */
export function addFurniture(scene: THREE.Scene, cam: FixedCamera): Furniture {
  const group = new THREE.Group()
  const shade = contactTexture()
  const bedG = bed(shade),
    bowlParts = bowl(shade),
    scaleParts = scale(shade),
    gardenG = garden()
  group.add(bedG, bowlParts.group, scaleParts.group, gardenG)
  scene.add(group)
  const spots = computeSpots(cam)

  const placed: [THREE.Object3D, Spot][] = [
    [bedG, spots.bed],
    [bowlParts.group, spots.bowl],
    [scaleParts.group, spots.scale],
    [gardenG, spots.garden],
  ]
  const furniture: Furniture = {
    group,
    spots,
    layout(next) {
      const fresh = computeSpots(next)
      for (const k of Object.keys(fresh) as (keyof Spots)[]) {
        const { center, ...size } = fresh[k]
        Object.assign(spots[k], size).center.copy(center)
      }
      // Everything faces the camera, so the bed's long side and the scale's display face the screen
      for (const [o, s] of placed) {
        o.position.copy(s.center)
        o.rotation.y = next.az
      }
      gardenG.scale.set(spots.garden.radius / GARDEN.radius, 1, spots.garden.depth / GARDEN.depth)
    },
    bowlFill(level) {
      bowlParts.kibble.count = Math.round(clamp(level, 0, 1) * KIBBLE)
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
        mat.dispose()
      })
    },
  }
  furniture.layout(cam)
  furniture.bowlFill(1)
  furniture.scaleReading(null)
  return furniture
}
