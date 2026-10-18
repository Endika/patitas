import * as THREE from 'three'
import { clamp, type Vec3 } from '@/engine/math'
import { playHalf, playWorld, type FixedCamera } from './camera'

/** A round footprint on the floor. */
export interface Spot {
  center: Vec3
  radius: number
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

const BED_R = 0.6,
  BOWL_R = 0.13,
  SCALE_R = 0.22,
  MUD_R = 0.26,
  GARDEN_R = 0.47

/**
 * Depth and side (a fraction of the play area's half width there) of each piece, so they stay in
 * frame for every aspect. The front pair sits ahead of where the puppies start.
 */
const LAYOUT = {
  bed: { d: 1.15, side: 0.55, r: BED_R },
  bowl: { d: -0.48, side: -0.8, r: BOWL_R },
  scale: { d: -0.48, side: 0.8, r: SCALE_R },
  mud: { d: 1.25, side: -0.68, r: MUD_R },
  garden: { d: 1.25, side: -0.68, r: GARDEN_R },
} as const

export function computeSpots(cam: FixedCamera): Spots {
  const spot = ({ d, side, r }: { d: number; side: number; r: number }): Spot => {
    const [x, z] = playWorld(cam, d, side * playHalf(cam, d))
    return { center: new THREE.Vector3(x, 0, z), radius: r }
  }
  return {
    bed: spot(LAYOUT.bed),
    bowl: spot(LAYOUT.bowl),
    scale: spot(LAYOUT.scale),
    mud: spot(LAYOUT.mud),
    garden: spot(LAYOUT.garden),
  }
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** How deep in the puddle a point is: 1 in the middle, easing to 0 at its edge. */
export function inMud(spots: Spots, x: number, z: number): number {
  const { center, radius } = spots.mud
  return 1 - smoothstep(0.3, 1, Math.hypot(x - center.x, z - center.z) / radius)
}

/** What puppies walk around: the garden is open ground. */
export function furnitureObstacles(spots: Spots): Circle[] {
  return [spots.bed, spots.bowl, spots.scale].map((s) => ({
    x: s.center.x,
    z: s.center.z,
    r: s.radius,
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
  /** Kept current: `layout` moves these in place. */
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

function bed(): THREE.Group {
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
  g.add(ring, pad)
  return g
}

const KIBBLE = 110

function bowl(): { group: THREE.Group; kibble: THREE.InstancedMesh } {
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
  g.add(dish, kibble)
  return { group: g, kibble }
}

function scale(): { group: THREE.Group; screen: HTMLCanvasElement; map: THREE.CanvasTexture } {
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
  head.scale.set(0.11, 0.035, 0.03)
  head.position.set(0, 0.04, 0.12)
  head.castShadow = true
  const screen = document.createElement('canvas')
  screen.width = 256
  screen.height = 80
  const map = new THREE.CanvasTexture(screen)
  map.colorSpace = THREE.SRGBColorSpace
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.047),
    new THREE.MeshBasicMaterial({ map, toneMapped: false }),
  )
  display.position.set(0, 0.048, 0.146)
  display.rotation.x = -0.35
  g.add(body, mat, head, display)
  return { group: g, screen, map }
}

function drawReading(screen: HTMLCanvasElement, text: string) {
  const g = screen.getContext('2d')
  if (!g) return
  g.fillStyle = INK
  g.fillRect(0, 0, screen.width, screen.height)
  g.fillStyle = '#cdeedb'
  g.font = '600 50px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, screen.width / 2, screen.height / 2 + 2)
}

/** An irregular disc with vertex colours, its rim `rim(a)` times `r` and height `y(t)` from the middle out. */
function blob(
  r: number,
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
        rr = r * t * rim(a)
      pos.push(rr * Math.cos(a), y(t), -rr * Math.sin(a))
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
      GARDEN_R,
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
  const wetEdge = new THREE.Color('#6e4b2e'),
    deep = new THREE.Color('#452915')
  const mud = new THREE.Mesh(
    blob(
      MUD_R,
      mudRim,
      (t) => -0.008 * (1 - t * t) + 0.004 * smoothstep(0.85, 1, t),
      (t, _a, out) => out.copy(deep).lerp(wetEdge, smoothstep(0.55, 1, t)),
      () => 1,
    ),
    // Drawn after the see-through grass, which writes no depth, so the sunken middle shows
    // Wet but not a mirror: seen this low it would reflect the pale room and the rim light
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.25,
      specularIntensity: 0.07,
      envMapIntensity: 0.4,
      transparent: true,
    }),
  )
  mud.position.y = 0.003
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
    const r = t * GARDEN_R * grassRim(a) * 0.95
    if (r < MUD_R * mudRim(a) * 1.08) continue
    p.set(r * Math.cos(a), 0, -r * Math.sin(a))
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
  const bedG = bed(),
    bowlParts = bowl(),
    scaleParts = scale(),
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
      for (const k of Object.keys(fresh) as (keyof Spots)[]) spots[k].center.copy(fresh[k].center)
      // Everything faces the camera, so the bed's long side and the scale's display face the screen
      for (const [o, s] of placed) {
        o.position.copy(s.center)
        o.rotation.y = next.az
      }
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
