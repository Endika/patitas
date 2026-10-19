import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { clamp, rng } from '@/engine/math'
import type { FixedCamera } from './camera'
import {
  BOWL,
  BOWL_STEP,
  computeSpots,
  formatKg,
  GARDEN,
  inMud,
  MUD,
  SCALE,
  smoothstep,
  type Furniture,
  type Spot,
} from './furniture'

const INK = '#22302e'

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

/** The bed's bolster: the tube's half thickness, and its height over that. */
const BOLSTER = { tube: 0.1, squash: 0.78 }
/** The fabric base the bolster sits on. */
const BED_BASE = 0.03

/**
 * A round bed built on a circle of `radius` and pressed to `depth` along the view: a fabric base,
 * a thick bolster all round and a cushion sunk in the middle.
 */
function bed(shade: THREE.Texture, { radius, depth }: Spot): THREE.Group {
  const g = new THREE.Group()
  const { tube, squash } = BOLSTER
  const lathe = (points: number[][], color: string) =>
    new THREE.Mesh(
      new THREE.LatheGeometry(
        points.map(([x, y]) => new THREE.Vector2(x, y)),
        64,
      ),
      new THREE.MeshStandardMaterial({ color, roughness: 1 }),
    )
  const base = lathe(
    [
      [0, 0],
      [radius - 0.02, 0],
      [radius, 0.012],
      [radius - 0.004, BED_BASE + 0.012],
      [0, BED_BASE + 0.012],
    ],
    '#b9765b',
  )
  base.receiveShadow = true
  const bolster = new THREE.Mesh(
    new THREE.TorusGeometry(radius - tube, tube, 20, 72),
    new THREE.MeshStandardMaterial({ color: '#e39a7c', roughness: 0.95 }),
  )
  bolster.rotation.x = -Math.PI / 2
  bolster.scale.z = squash
  bolster.position.y = BED_BASE + tube * squash
  bolster.castShadow = bolster.receiveShadow = true
  // Lowest in the middle, rising to tuck under the bolster; drawn from the rim in, so it faces up
  const inner = radius - tube
  const cushion = lathe(
    [
      [inner + 0.02, BED_BASE + 0.07],
      [0.85 * inner, BED_BASE + 0.05],
      [0.5 * inner, BED_BASE + 0.028],
      [0, BED_BASE + 0.022],
    ],
    '#f6dccd',
  )
  cushion.receiveShadow = true
  g.add(base, bolster, cushion, contact(shade, radius, radius, 0.35))
  g.scale.z = depth / radius
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
  // Over the mat the bowls stand on
  const shadow = contact(shade, BOWL.radius, BOWL.depth, 0.45)
  shadow.position.y = 2 * MAT_Y
  g.add(dish, kibble, shadow)
  return { group: g, kibble }
}

/** The mat's height over the floor, and how far it reaches past the bowls on it. */
const MAT_Y = 0.002,
  MAT = { side: 0.18, depth: 0.15, corner: 0.08 }

/** A flat rounded mat under a row of `n` bowls `BOWL_STEP` apart. */
function bowlMat(n: number): THREE.Mesh {
  const hx = ((n - 1) * BOWL_STEP) / 2 + MAT.side,
    hz = MAT.depth,
    r = MAT.corner
  const shape = new THREE.Shape()
  shape.moveTo(-hx + r, -hz)
  shape.lineTo(hx - r, -hz)
  shape.quadraticCurveTo(hx, -hz, hx, -hz + r)
  shape.lineTo(hx, hz - r)
  shape.quadraticCurveTo(hx, hz, hx - r, hz)
  shape.lineTo(-hx + r, hz)
  shape.quadraticCurveTo(-hx, hz, -hx, hz - r)
  shape.lineTo(-hx, -hz + r)
  shape.quadraticCurveTo(-hx, -hz, -hx + r, -hz)
  const m = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 6),
    new THREE.MeshStandardMaterial({ color: '#8fb3a6', roughness: 0.95 }),
  )
  m.geometry.rotateX(-Math.PI / 2)
  m.position.y = MAT_Y
  m.receiveShadow = true
  return m
}

/** The scale's readout: the canvas it is drawn on and the face that shows it. */
const SCREEN = { width: 240, height: 80, face: [0.153, 0.051] as const }

/**
 * A vet's platform scale on the `SCALE` footprint: a low rounded platform with a dark rubber top,
 * and on its front edge, to the right, a short mast holding the display, so the puppy standing on
 * it does not hide it.
 */
function scale(shade: THREE.Texture): { group: THREE.Group; readout: ScaleReadout } {
  const g = new THREE.Group()
  const w = 2 * SCALE.radius,
    d = 2 * SCALE.depth,
    h = 0.05
  const platform = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, d, 3, 0.02),
    new THREE.MeshStandardMaterial({ color: '#d9dfdd', roughness: 0.55 }),
  )
  platform.position.y = h / 2
  platform.castShadow = platform.receiveShadow = true
  const rubber = new THREE.Mesh(
    new RoundedBoxGeometry(w - 0.05, 0.012, d - 0.05, 2, 0.005),
    new THREE.MeshStandardMaterial({ color: '#3d4a47', roughness: 0.95 }),
  )
  rubber.position.y = h
  rubber.receiveShadow = true
  // On the front edge: a puppy standing on the scale is wider than the gap left in front of it
  const post = { x: 0.12, z: SCALE.depth - 0.012, height: 0.065 }
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.013, post.height, 12),
    new THREE.MeshStandardMaterial({ color: '#9aa3a0', roughness: 0.5 }),
  )
  mast.position.set(post.x, h + post.height / 2, post.z)
  const head = new THREE.Group()
  head.position.set(post.x, h + post.height + 0.03, post.z + 0.012)
  // Tipped back a little towards the camera, which looks down on it
  head.rotation.x = -0.3
  const box = new THREE.Mesh(
    new RoundedBoxGeometry(0.175, 0.068, 0.035, 2, 0.008),
    new THREE.MeshStandardMaterial({ color: '#24302c', roughness: 0.6 }),
  )
  box.castShadow = true
  const screen = document.createElement('canvas')
  screen.width = SCREEN.width
  screen.height = SCREEN.height
  const readout = scaleReadout(screen)
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(...SCREEN.face),
    new THREE.MeshBasicMaterial({ map: readout.map, toneMapped: false }),
  )
  display.name = 'scale-display'
  display.position.z = 0.0185
  head.add(box, display)
  g.add(platform, rubber, mast, head, contact(shade, SCALE.radius, SCALE.depth, 0.35))
  return { group: g, readout }
}

export interface ScaleReadout {
  map: THREE.CanvasTexture
  /** Shows `kg`, or nothing; the texture is drawn and uploaded again only when the text changes. */
  show(kg: number | null): void
}

/** The scale's display drawn on `screen`, blank to start with. */
export function scaleReadout(screen: HTMLCanvasElement): ScaleReadout {
  const map = new THREE.CanvasTexture(screen)
  map.colorSpace = THREE.SRGBColorSpace
  let shown: string | null = null
  return {
    map,
    show(kg) {
      const text = formatKg(kg)
      if (text === shown) return
      shown = text
      drawReading(screen, text)
      map.needsUpdate = true
    },
  }
}

/** Green digits on the dark display while weighing, «5,24» with a small «kg»; dark otherwise. */
function drawReading(screen: HTMLCanvasElement, text: string) {
  const g = screen.getContext('2d')
  if (!g) return
  const { width, height } = screen
  g.fillStyle = text ? '#1f2b29' : '#182220'
  g.fillRect(0, 0, width, height)
  if (!text) return
  const [digits = '', unit = ''] = text.split(' ')
  g.fillStyle = '#9be3c4'
  g.textBaseline = 'alphabetic'
  g.font = '700 60px ui-monospace, Menlo, Consolas, monospace'
  const big = g.measureText(digits).width
  g.font = '700 24px ui-monospace, Menlo, Consolas, monospace'
  const small = g.measureText(unit).width
  const left = (width - big - 8 - small) / 2,
    base = height / 2 + 21
  g.fillText(unit, left + big + 8, base)
  g.font = '700 60px ui-monospace, Menlo, Consolas, monospace'
  g.fillText(digits, left, base)
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

/**
 * The puddle, on the backdrop's garden ground: just clear of the floor, with a soft lip around a
 * lower middle.
 */
function garden(): THREE.Group {
  const g = new THREE.Group()
  const mudRim = (a: number) => wobble(a, 0.08, 4.1)
  const wetEdge = new THREE.Color('#5a3b22'),
    deep = new THREE.Color('#3a2312')
  const mud = new THREE.Mesh(
    blob(
      MUD.size * GARDEN.radius,
      MUD.size * GARDEN.depth,
      mudRim,
      (t) => 0.002 + 0.005 * t * t * (1 - smoothstep(0.9, 1, t)),
      (t, _a, out) => out.copy(deep).lerp(wetEdge, smoothstep(0.55, 1, t)),
      (t) => 1 - smoothstep(0.92, 1, t),
    ),
    // Damp rather than glossy: seen this low, the rim light glances off it from behind and any
    // ordinary shine turns the puddle grey, so its specular is nearly off
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.6,
      specularIntensity: 0.03,
      envMapIntensity: 0.25,
      transparent: true,
      depthWrite: false,
    }),
  )
  mud.position.set(MUD.u * GARDEN.radius, 0, MUD.v * GARDEN.depth)
  mud.receiveShadow = true
  mud.renderOrder = 2
  g.add(mud)
  return g
}

/** A bed and a bowl for each of `puppies`, the scale and the garden corner, laid out for `cam`. */
export function addFurniture(scene: THREE.Scene, cam: FixedCamera, puppies: 1 | 2): Furniture {
  const group = new THREE.Group()
  const shade = contactTexture()
  const spots = computeSpots(cam, puppies)
  const beds = spots.beds.map((s) => bed(shade, s)),
    bowls = spots.bowls.map(() => bowl(shade)),
    mat = bowlMat(spots.bowls.length),
    scaleParts = scale(shade),
    gardenG = garden()
  group.add(...beds, mat, ...bowls.map((b) => b.group), scaleParts.group, gardenG)
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
      mat.position.set(0, MAT_Y, 0)
      for (const b of spots.bowls) mat.position.add(b.center)
      mat.position.divideScalar(spots.bowls.length).setY(MAT_Y)
      mat.rotation.y = next.az
      gardenG.scale.set(spots.garden.radius / GARDEN.radius, 1, spots.garden.depth / GARDEN.depth)
    },
    bowlFill(place, level) {
      const parts = bowls[place]
      if (parts) parts.kibble.count = Math.round(clamp(level, 0, 1) * KIBBLE)
    },
    scaleReading: (kg) => scaleParts.readout.show(kg),
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
