import * as THREE from 'three'
import { clamp, rng } from '@/engine/math'
import { PLAY, playLocal, type FixedCamera } from './camera'
import type { Spot } from './furniture'

export type Zone = 'garden' | 'house'

/**
 * Where the garden ends and the house begins: a line along the view this far across from the
 * camera's target, negative to the left, so the puppies start on it.
 */
export const SPLIT = -0.1
/** The fence and the house wall, as depth from the camera's target. */
export const BACK_D = PLAY.far + 0.5

export const STRIP_HALF = 0.032
const WALL_H = 1.25
const FENCE = { step: 0.16, width: 0.08, height: 0.55, board: 0.45 }
const WINDOW = { x: 0.75, bottom: 0.4, top: 0.92, width: 0.62, frame: 0.045 }
/** The fence and its bushes are built this far left of the split, for the widest screens. */
const REACH = 12
const BLADES = 1800
const BLADE_LIGHT = new THREE.Color('#729a4b'),
  BLADE_DARK = new THREE.Color('#5a8039')

export interface Backdrop {
  group: THREE.Group
  /**
   * Fits the ground, wall and sky to `cam`'s frame; no grass grows inside `clear`, and the window
   * moves along the wall to stay clear of `beds` and the puppies asleep in them.
   */
  layout(cam: FixedCamera, clear?: Spot, beds?: readonly Spot[]): void
  zoneAt(x: number, z: number): Zone
  dispose(): void
}

/** The view's corners as the floor and the back see them, in the backdrop's own frame. */
interface Reach {
  /** Nearest floor depth in view. */
  near: number
  /** Widest half width of the view at the sky's depth. */
  half: number
  /** Highest point of the view at the sky's depth. */
  top: number
}

/**
 * The backdrop's frame sits on the floor under the camera's target, turned by its azimuth:
 * `x` runs across the screen, `-z` away from the camera, so depth `d` is `-z`.
 */
function rays(cam: FixedCamera) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
  const camD = cam.dist * Math.cos(cam.el),
    rise = cam.dist * Math.sin(cam.el),
    camY = cam.target.y + rise
  const len = Math.hypot(rise, camD),
    fy = -rise / len,
    fz = -camD / len
  return {
    camD,
    camY,
    /** The ray through the screen point (`sx`, `sy`), each from -1 to 1. */
    dir: (sx: number, sy: number) => ({
      x: sx * cam.tanH,
      y: fy - fz * sy * tanV,
      z: fz + fy * sy * tanV,
    }),
  }
}

function reach(cam: FixedCamera, skyD: number): Reach {
  const { camD, camY, dir } = rays(cam)
  const out = { near: Infinity, half: 0, top: 0 }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const r = dir(sx, sy)
      if (r.y < 0) out.near = Math.min(out.near, -(camD + (r.z * camY) / -r.y))
      const t = (camD + skyD) / -r.z
      out.half = Math.max(out.half, Math.abs(r.x * t))
      out.top = Math.max(out.top, camY + r.y * t)
    }
  return out
}

const GROUND = /* glsl */ `
uniform vec2 uOrigin;
uniform vec2 uAhead;
uniform vec3 uGrassFar, uGrassNear, uWoodFar, uWoodNear, uSeam, uStrip;
varying vec2 vGround;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
/** A thin line at the integers of u, w wide, faded to its coverage where it is under a pixel. */
float seam(float u, float w) {
  float f = abs(fract(u + 0.5) - 0.5), du = fwidth(u);
  return (1.0 - smoothstep(w, w + du, f)) * min(1.0, 2.0 * w / max(du, 1e-5));
}
`

/**
 * The floor: grass with patches left of the split, planks right of it and a strip on the line,
 * all from the world position so it holds when the plane is stretched to a new frame.
 */
function groundMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 })
  const uniforms = {
    uOrigin: { value: new THREE.Vector2() },
    uAhead: { value: new THREE.Vector2(0, -1) },
    uGrassFar: { value: new THREE.Color('#557a38') },
    uGrassNear: { value: new THREE.Color('#6c9147') },
    uWoodFar: { value: new THREE.Color('#8a5f38') },
    uWoodNear: { value: new THREE.Color('#a07549') },
    uSeam: { value: new THREE.Color('#6a4526') },
    uStrip: { value: new THREE.Color('#6e4f2c') },
  }
  mat.userData.uniforms = uniforms
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  vec2 rel = vGround - uOrigin;
  float d = dot(rel, uAhead), side = dot(rel, vec2(-uAhead.y, uAhead.x));
  float s = side - ${SPLIT.toFixed(3)};
  float nearness = smoothstep(${BACK_D.toFixed(3)}, -2.5, d);
  vec2 q = vec2(side, d);
  float patches = vnoise(q * 1.6) * 0.55 + vnoise(q * 4.1) * 0.3 + vnoise(q * 10.3) * 0.15;
  vec3 grass = mix(uGrassFar, uGrassNear, nearness) * (0.84 + 0.3 * patches);
  grass *= 1.0 - 0.14 * smoothstep(0.6, 0.9, vnoise(q * 23.0));
  float u = s / 0.13, plank = floor(u);
  float v = (d + hash(vec2(plank, 3.1)) * 1.3) / 1.3;
  vec3 wood = mix(uWoodFar, uWoodNear, nearness);
  wood *= 0.92 + 0.14 * hash(vec2(plank, floor(v)));
  wood *= 0.95 + 0.08 * vnoise(vec2(u * 9.0 + plank * 7.0, d * 1.3));
  wood = mix(wood, uSeam, 0.75 * max(seam(u, 0.03), seam(v, 0.006)));
  float fw = fwidth(s);
  vec3 ground = mix(grass, wood, smoothstep(-fw, fw, s));
  ground *= 1.0 - 0.13 * (1.0 - smoothstep(STRIP_HALF, STRIP_HALF + 0.06, abs(s)));
  float strip = 1.0 - smoothstep(STRIP_HALF - 0.004, STRIP_HALF + fw, abs(s));
  vec3 lip = uStrip * (0.88 + 0.16 * smoothstep(STRIP_HALF, 0.0, abs(s)));
  ground = mix(ground, lip, strip);
  ground *= 1.0 - 0.2 * smoothstep(${(BACK_D - 0.4).toFixed(3)}, ${BACK_D.toFixed(3)}, d);
  diffuseColor.rgb = ground;
  float woodness = step(0.0, s) * (1.0 - strip);`.replace(/STRIP_HALF/g, STRIP_HALF.toFixed(3)),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.95, 0.6, woodness);',
      )
  }
  return mat
}

function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: new THREE.Color('#eef4ea') },
      uHigh: { value: new THREE.Color('#cfe6ef') },
      uSpan: { value: new THREE.Vector2(0.5, 2) },
    },
    vertexShader: /* glsl */ `varying float vY;
void main() {
  vY = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `uniform vec3 uLow, uHigh;
uniform vec2 uSpan;
varying float vY;
void main() {
  gl_FragColor = vec4(mix(uLow, uHigh, smoothstep(uSpan.x, uSpan.y, vY)), 1.0);
  #include <colorspace_fragment>
}`,
  })
}

/** A unit plane standing on its bottom-left corner, shading from `bottom` up to `top`. */
function gradientPlane(top: string, bottom: string): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1)
  geo.translate(0.5, 0.5, 0)
  const a = new THREE.Color(top),
    b = new THREE.Color(bottom)
  const pos = geo.getAttribute('position')
  const col: number[] = []
  for (let i = 0; i < pos.count; i++) col.push(...(pos.getY(i) > 0.5 ? a : b).toArray())
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return geo
}

function picketGeometry(): THREE.BufferGeometry {
  const { width: w, height: h } = FENCE
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, 0)
  shape.lineTo(w / 2, 0)
  shape.lineTo(w / 2, h - w / 2)
  shape.absarc(0, h - w / 2, w / 2, 0, Math.PI, false)
  shape.lineTo(-w / 2, 0)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.016,
    bevelThickness: 0.004,
    bevelSize: 0.005,
    bevelSegments: 2,
    curveSegments: 6,
  })
  geo.translate(0, 0, -0.008)
  return geo
}

/**
 * One tapered blade: two crossed triangles, each also wound the other way, so it shows from any
 * side with the same upward normal. A double-sided material would flip that normal on the back
 * faces and turn them dark.
 */
function bladeGeometry(): THREE.BufferGeometry {
  const w = 0.0055,
    h = 0.038
  const geo = new THREE.BufferGeometry()
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        [-w, 0, 0, w, 0, 0, 0, h, 0],
        [w, 0, 0, -w, 0, 0, 0, h, 0],
        [0, 0, -w, 0, 0, w, 0, h, 0],
        [0, 0, w, 0, 0, -w, 0, h, 0],
      ].flat(),
      3,
    ),
  )
  // Lit like the ground under it, so the blades read as soft grass rather than facets
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array(12).fill([0, 1, 0]).flat(), 3))
  return geo
}

/** A lumpy round for the bushes, smooth enough to light softly. */
function lumpGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 16, 12)
  const pos = geo.getAttribute('position'),
    p = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i)
    const k = 1 + 0.07 * Math.sin(5 * p.x + 2) * Math.sin(4 * p.y + 1) * Math.sin(5 * p.z)
    pos.setXYZ(i, p.x * k, p.y * k, p.z * k)
  }
  geo.computeVertexNormals()
  return geo
}

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
  /** How far its front stands out from the back. */
  front: number
  depth: number
  color: string
}

const matrix = new THREE.Matrix4(),
  quat = new THREE.Quaternion(),
  euler = new THREE.Euler(),
  at = new THREE.Vector3(),
  size = new THREE.Vector3(),
  tint = new THREE.Color()

function setBox(mesh: THREE.InstancedMesh, i: number, b: Box) {
  at.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, -BACK_D + b.front - b.depth / 2)
  size.set(b.x1 - b.x0, b.y1 - b.y0, b.depth)
  mesh.setMatrixAt(i, matrix.compose(at, quat.identity(), size))
  mesh.setColorAt(i, tint.set(b.color))
}

/** The window's frame, mullion and sill, the window's middle at `x` across the wall. */
function windowTrim(x: number): Box[] {
  const { bottom, top, width, frame } = WINDOW
  const l = x - width / 2,
    r = x + width / 2,
    white = '#fbf8f2'
  return [
    { x0: l, x1: r, y0: top - frame, y1: top, front: 0.03, depth: 0.03, color: white },
    { x0: l, x1: r, y0: bottom, y1: bottom + frame, front: 0.03, depth: 0.03, color: white },
    { x0: l, x1: l + frame, y0: bottom, y1: top, front: 0.03, depth: 0.03, color: white },
    { x0: r - frame, x1: r, y0: bottom, y1: top, front: 0.03, depth: 0.03, color: white },
    { x0: x - 0.015, x1: x + 0.015, y0: bottom, y1: top, front: 0.025, depth: 0.02, color: white },
    {
      x0: l - 0.04,
      x1: r + 0.04,
      y0: bottom - 0.03,
      y1: bottom + 0.005,
      front: 0.06,
      depth: 0.06,
      color: '#f1e9dc',
    },
  ]
}

/** How far a curled sleeper reaches across its bed, as `computeSpots` keeps in frame. */
const SLEEPER_REACH = 0.45

/**
 * Where the window's middle goes across the wall: nearest its usual place where nothing in front
 * of it, a bed or a puppy asleep in one, is seen over it, or else where the least is; always
 * whole in view.
 */
function windowAt(cam: FixedCamera, beds: readonly Spot[]): number {
  const w = WINDOW.width / 2 + 0.1,
    camD = cam.dist * Math.cos(cam.el)
  // The wall's half width in view where the window's sill meets it, a little under the floor's
  const lo = SPLIT + w,
    hi = (camD + BACK_D) * cam.tanH - w
  if (hi <= lo) return WINDOW.x
  const spans = beds.map((b) => {
    const q = playLocal(cam, b.center.x, b.center.z),
      k = (camD + BACK_D) / (camD + q.d),
      r = Math.max(b.radius, SLEEPER_REACH)
    return [(q.side - r) * k, (q.side + r) * k] as const
  })
  const covered = (x: number) =>
    spans.reduce((t, [a, b]) => t + Math.max(0, Math.min(b, x + w) - Math.max(a, x - w)), 0)
  let best = clamp(WINDOW.x, lo, hi),
    least = covered(best)
  for (let x = lo; x <= hi; x += 0.02) {
    const c = covered(x)
    if (
      c < least - 1e-9 ||
      (c <= least + 1e-9 && Math.abs(x - WINDOW.x) < Math.abs(best - WINDOW.x))
    )
      [best, least] = [x, c]
  }
  return best
}

/** The trim that runs to the frame's edge: skirting, the wall's top and the fence's boards. */
function edgeTrim(half: number): Box[] {
  return [
    { x0: SPLIT, x1: half, y0: 0, y1: 0.075, front: 0.022, depth: 0.022, color: '#cfb08a' },
    {
      x0: SPLIT - 0.03,
      x1: half,
      y0: WALL_H - 0.005,
      y1: WALL_H + 0.03,
      front: 0.04,
      depth: 0.08,
      color: '#e3cfb2',
    },
    {
      x0: SPLIT - 0.03,
      x1: SPLIT + 0.03,
      y0: 0,
      y1: WALL_H,
      front: 0.04,
      depth: 0.08,
      color: '#d8c3a4',
    },
    {
      x0: -half,
      x1: SPLIT - 0.03,
      y0: 0,
      y1: FENCE.board,
      front: 0.012,
      depth: 0.012,
      color: '#e9dcc4',
    },
    {
      x0: -half,
      x1: SPLIT - 0.03,
      y0: FENCE.board - 0.03,
      y1: FENCE.board,
      front: 0.03,
      depth: 0.018,
      color: '#ddcdb0',
    },
  ]
}

const BUSH_GREENS = ['#4f7a36', '#5e8a41', '#46702f'],
  FLOWERS = ['#f2b8a0', '#f7d36b', '#fff4e6']

/** Bushes along the fence, from near the split out to `REACH`, with a few flowers on each. */
function plantBushes(
  lumps: THREE.InstancedMesh,
  flowers: THREE.InstancedMesh,
): { lumps: number; flowers: number } {
  const rand = rng(23)
  let nl = 0,
    nf = 0
  const n = new THREE.Vector3()
  for (let x = SPLIT - 0.5; x > SPLIT - REACH && nl < lumps.count - 3;) {
    const parts = 2 + Math.floor(rand() * 2)
    for (let k = 0; k < parts; k++) {
      const big = k === 0
      size.set(
        (big ? 0.26 : 0.17) + rand() * 0.08,
        (big ? 0.2 : 0.14) + rand() * 0.06,
        0.13 + rand() * 0.04,
      )
      at.set(
        x + (big ? 0 : (k === 1 ? 1 : -1) * (0.22 + rand() * 0.08)),
        size.y * 0.72,
        -BACK_D + 0.17 + (big ? 0 : 0.05),
      )
      lumps.setMatrixAt(nl, matrix.compose(at, quat.identity(), size))
      lumps.setColorAt(nl, tint.set(BUSH_GREENS[Math.floor(rand() * BUSH_GREENS.length)]!))
      nl++
      for (let f = big ? 3 : 1; f > 0 && nf < flowers.count; f--) {
        n.set(rand() * 1.4 - 0.7, 0.2 + rand() * 0.7, 0.55 + rand() * 0.4).normalize()
        const p = n.multiply(size).add(at)
        const r = 0.018 + rand() * 0.008
        flowers.setMatrixAt(nf, matrix.compose(p, quat.identity(), new THREE.Vector3(r, r, r)))
        flowers.setColorAt(nf, tint.set(FLOWERS[Math.floor(rand() * FLOWERS.length)]!))
        nf++
      }
    }
    x -= 0.9 + rand() * 0.6
  }
  return { lumps: nl, flowers: nf }
}

/**
 * The room around the puppies: garden ground on the left and a plank floor on the right with a
 * strip on the line between them, and at the back a fence with bushes, the house wall with its
 * window, and the sky. Planes stretch to cover the frame on every `layout`; none casts a shadow.
 */
export function createBackdrop(cam: FixedCamera): Backdrop {
  const group = new THREE.Group()
  group.name = 'backdrop'
  const groundMat = groundMaterial()
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat)
  floor.name = 'floor'
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  const skyMat = skyMaterial()
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), skyMat)
  sky.name = 'sky'
  const wall = new THREE.Mesh(
    gradientPlane('#f3e6d3', '#e8d5bb'),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
  )
  wall.name = 'wall'
  const pane = new THREE.Mesh(
    gradientPlane('#d9edf4', '#b3d4e1'),
    new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  )
  pane.name = 'pane'
  pane.scale.set(WINDOW.width, WINDOW.top - WINDOW.bottom, 1)
  const fixedTrim = windowTrim(WINDOW.x)
  const trim = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    fixedTrim.length + edgeTrim(0).length,
  )
  trim.name = 'trim'
  const pickets = new THREE.InstancedMesh(
    picketGeometry(),
    new THREE.MeshStandardMaterial({ roughness: 0.75 }),
    Math.ceil(REACH / FENCE.step),
  )
  pickets.name = 'pickets'
  const prand = rng(5)
  for (let i = 0; i < pickets.count; i++) {
    at.set(SPLIT - 0.1 - i * FENCE.step, 0, -BACK_D + 0.032)
    euler.set(0, 0, (prand() - 0.5) * 0.03)
    pickets.setMatrixAt(i, matrix.compose(at, quat.setFromEuler(euler), size.set(1, 1, 1)))
    pickets.setColorAt(i, tint.set('#f6efe2').offsetHSL(0, 0, (prand() - 0.5) * 0.03))
  }
  const bushes = new THREE.InstancedMesh(
    lumpGeometry(),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    48,
  )
  bushes.name = 'bushes'
  const blooms = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    64,
  )
  blooms.name = 'flowers'
  const planted = plantBushes(bushes, blooms)
  bushes.count = planted.lumps
  blooms.count = planted.flowers
  const blades = new THREE.InstancedMesh(
    bladeGeometry(),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    BLADES,
  )
  blades.name = 'blades'
  group.add(floor, sky, wall, pane, trim, pickets, bushes, blooms, blades)
  for (const o of group.children) o.frustumCulled = false

  const origin = new THREE.Vector2(),
    ahead = new THREE.Vector2(0, -1)
  /** Local frame point (`x` across, depth `d`) to world x and z. */
  const toWorld = (x: number, d: number, out: THREE.Vector3) =>
    out.set(origin.x + x * -ahead.y + d * ahead.x, 0, origin.y + x * ahead.x + d * ahead.y)

  const grow = (cam: FixedCamera, clear?: Spot) => {
    const { camD, camY, dir } = rays(cam)
    const rand = rng(11)
    const cf = Math.cos(clear?.facing ?? 0),
      sf = Math.sin(clear?.facing ?? 0)
    let n = 0
    for (let tries = 0; n < BLADES && tries < BLADES * 12; tries++) {
      const sy = rand() * 1.5 - 1
      const r = dir(rand() * 1.4 - 1, sy)
      if (r.y >= 0) continue
      const t = camY / -r.y,
        x = r.x * t,
        d = -(camD + r.z * t)
      if (x > SPLIT - STRIP_HALF - 0.01 || d > BACK_D - 0.06) continue
      toWorld(x, d, at)
      if (clear) {
        const rx = at.x - clear.center.x,
          rz = at.z - clear.center.z
        const u = (rx * cf - rz * sf) / clear.radius,
          v = (rx * sf + rz * cf) / clear.depth
        if (Math.hypot(u, v) < 1.12) continue
      }
      euler.set((rand() - 0.5) * 0.7, rand() * 6, (rand() - 0.5) * 0.7)
      at.set(x, 0, -d)
      // The nearest blades are the biggest on screen: shorter and closer to the ground's colour,
      // they read as soft lawn rather than stubble
      const far = Math.min(1, (sy + 1) / 0.7)
      size.set(1, (0.5 + rand() * 0.6) * (0.35 + 0.65 * far), 1)
      blades.setMatrixAt(n, matrix.compose(at, quat.setFromEuler(euler), size))
      blades.setColorAt(
        n,
        tint
          .copy(BLADE_DARK)
          .lerp(BLADE_LIGHT, rand())
          .lerp(BLADE_LIGHT, 0.6 * (1 - far)),
      )
      n++
    }
    blades.count = n
    blades.instanceMatrix.needsUpdate = true
    if (blades.instanceColor) blades.instanceColor.needsUpdate = true
  }

  const backdrop: Backdrop = {
    group,
    layout(next, clear, beds = []) {
      group.position.set(next.target.x, 0, next.target.z)
      group.rotation.y = next.az
      origin.set(next.target.x, next.target.z)
      ahead.set(-Math.sin(next.az), -Math.cos(next.az))
      const u = groundMat.userData.uniforms as {
        uOrigin: { value: THREE.Vector2 }
        uAhead: { value: THREE.Vector2 }
      }
      u.uOrigin.value.copy(origin)
      u.uAhead.value.copy(ahead)

      const skyD = BACK_D + 0.12
      const view = reach(next, skyD)
      const half = view.half + 0.3
      const near = view.near - 0.3,
        far = skyD + 0.05
      floor.scale.set(2 * half, far - near, 1)
      floor.position.set(0, 0, -(near + far) / 2)
      sky.scale.set(2 * half, view.top + 0.3, 1)
      sky.position.set(0, (view.top + 0.3) / 2, -skyD)
      ;(skyMat.uniforms.uSpan!.value as THREE.Vector2).set(FENCE.height * 0.8, view.top)
      wall.position.set(SPLIT, 0, -BACK_D)
      wall.scale.set(half - SPLIT, WALL_H, 1)
      const wx = windowAt(next, beds)
      pane.position.set(wx - WINDOW.width / 2, WINDOW.bottom, -BACK_D + 0.004)
      windowTrim(wx).forEach((b, i) => setBox(trim, i, b))
      edgeTrim(half).forEach((b, i) => setBox(trim, fixedTrim.length + i, b))
      trim.instanceMatrix.needsUpdate = true
      if (trim.instanceColor) trim.instanceColor.needsUpdate = true
      pickets.count = Math.min(
        pickets.instanceMatrix.count,
        Math.max(0, Math.ceil((half + SPLIT) / FENCE.step) + 1),
      )
      grow(next, clear)
    },
    zoneAt(x, z) {
      const side = (x - origin.x) * -ahead.y + (z - origin.y) * ahead.x
      return side < SPLIT ? 'garden' : 'house'
    },
    dispose() {
      group.removeFromParent()
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        if (o instanceof THREE.InstancedMesh) o.dispose()
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      })
    },
  }
  backdrop.layout(cam)
  return backdrop
}
