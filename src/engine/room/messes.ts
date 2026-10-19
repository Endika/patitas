import * as THREE from 'three'
import type { Mess, MessKind, PlaceAccident } from '@/domain/care'
import { clamp, type Vec3 } from '@/engine/math'
import type { Underfoot } from '@/engine/puppy/dirt'
import { PLAY, playHalf, playLocal, playWorld, type FixedCamera } from './camera'
import { furnitureObstacles, inMud, type Spots } from './furniture'

/** How far each kind reaches on the floor, for the paws that step in it. */
export const MESS_R: Record<MessKind, number> = { pee: 0.1, poop: 0.06 }
/** Half the side of the square a tap may land in: a fingertip and then some. */
export const HIT_PX = 30
/** Seconds the scoop or the cloth takes: it shrinks, fades and sparkles. */
export const CLEAN_TIME = 0.4

/** Seconds a puddle takes to spread, and a poop to plop down. */
const SPREAD_TIME = 1.2,
  PLOP_TIME = 0.25
/** Accidents keep this clear of the furniture's rims, of the garden and of each other. */
const CLEAR = 0.12,
  APART = 0.3
/** Inside the play area by this much at the near and far ends, and this share of its width. */
const EDGE_D = 0.12,
  EDGE_SIDE = 0.85
const TRIES = 60
/** Room for both puppies' messes and a couple being cleaned. */
const SLOTS = 8

export function messLocal(cam: FixedCamera, x: number, z: number): { x: number; z: number } {
  const q = playLocal(cam, x, z)
  return { x: clamp(q.side / q.half, -1, 1), z: clamp(q.d, PLAY.near, PLAY.far) }
}

export function messWorld(cam: FixedCamera, mess: Pick<Mess, 'x' | 'z'>, out: Vec3): Vec3 {
  const [x, z] = playWorld(cam, mess.z, mess.x * playHalf(cam, mess.z))
  return out.set(x, 0, z)
}

const inOval = (s: Spots['garden'], x: number, z: number, grow: number) => {
  const rx = x - s.center.x,
    rz = z - s.center.z
  const u = (rx * Math.cos(s.facing) - rz * Math.sin(s.facing)) / (s.radius + grow),
    v = (rx * Math.sin(s.facing) + rz * Math.cos(s.facing)) / (s.depth + grow)
  return Math.hypot(u, v) < 1
}

/**
 * Where an accident while away lands: a random spot of open floor in the play area, clear of the
 * beds, bowls and scale, of the garden and its puddle, and of the messes already there. One placer
 * for every puppy in the room keeps their messes apart too, and `around` are those any puppy
 * already left on the floor.
 */
export function placeAccident(
  cam: FixedCamera,
  spots: Spots,
  random: () => number = Math.random,
  around: readonly Pick<Mess, 'x' | 'z'>[] = [],
): PlaceAccident {
  const tmp = new THREE.Vector3(),
    other = new THREE.Vector3()
  const placed = around.map(({ x, z }) => ({ x, z }))
  return (kind, taken) => {
    const r = MESS_R[kind]
    for (let n = 0; n < TRIES; n++) {
      const z = PLAY.near + EDGE_D + random() * (PLAY.far - PLAY.near - 2 * EDGE_D),
        x = (random() * 2 - 1) * EDGE_SIDE
      const p = messWorld(cam, { x, z }, tmp)
      if (furnitureObstacles(spots).some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r + CLEAR + r))
        continue
      if (inMud(spots, p.x, p.z) > 0 || inOval(spots.garden, p.x, p.z, CLEAR)) continue
      const near = (m: { x: number; z: number }) => messWorld(cam, m, other).distanceTo(p) < APART
      if (taken.some(near) || placed.some(near)) continue
      placed.push({ x, z })
      return { x, z }
    }
    return null
  }
}

/** A flat, slightly lopsided puddle outline, the same for a given `seed`. */
function puddleGeometry(seed: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const N = 28
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2
    const r =
      MESS_R.pee *
      (0.86 +
        0.1 * Math.sin(a * 2 + seed) +
        0.06 * Math.sin(a * 3 + seed * 2.3) +
        0.04 * Math.cos(a * 5 + seed))
    const x = Math.cos(a) * r * 1.15,
      y = Math.sin(a) * r * 0.85
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  const g = new THREE.ShapeGeometry(shape, 1)
  g.rotateX(-Math.PI / 2)
  return g
}

/** A four-pointed glint, for the moment it comes clean. */
function sparkleGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const R = 0.07,
    r = 0.014
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2,
      k = i % 2 ? r : R
    if (i === 0) shape.moveTo(Math.cos(a) * k, Math.sin(a) * k)
    else shape.lineTo(Math.cos(a) * k, Math.sin(a) * k)
  }
  return new THREE.ShapeGeometry(shape)
}

interface Slot {
  group: THREE.Group
  pee: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  poop: THREE.Group
  poopMat: THREE.MeshStandardMaterial
  sparkle: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  mess: Mess | null
  /** Seconds since it appeared, and since it started going; −1 while it stays. */
  age: number
  gone: number
  seen: boolean
}

export interface MessLayer {
  group: THREE.Group
  /** The live messes as the paws meet them; a new array whenever the set changes. */
  underfoot: readonly Underfoot[]
  /** Each frame: `begin`, `show` every waiting mess, `end`. Those not shown are cleaned away. */
  begin(): void
  show(mess: Mess, cam: FixedCamera): void
  end(): void
  /** The frame moved: every mess goes back to its place in the play area. */
  relayout(cam: FixedCamera): void
  step(dt: number): void
  /** The waiting mess nearest a tap at (x, y) pixels on a `w` × `h` canvas, if one is close enough. */
  hit(camera: THREE.Camera, x: number, y: number, w: number, h: number): Mess | null
  dispose(): void
}

const PEE_COLOR = '#dcbc4e',
  POOP_COLOR = '#5a3a1e',
  SPARKLE_COLOR = '#fffbe8'
const PEE_OPACITY = 0.75

/** Stacked, tapering blobs: the classic swirl, small and cartoonish. */
const POOP_BLOBS: [y: number, r: number, squash: number][] = [
  [0.018, 0.045, 0.55],
  [0.048, 0.032, 0.6],
  [0.071, 0.018, 0.75],
]

/**
 * The puddles and poops on the floor, drawn from a fixed pool so a frame never builds anything:
 * they spread or plop in when they appear and shrink away with a sparkle when cleaned.
 */
export function createMessLayer(scene: THREE.Scene): MessLayer {
  const group = new THREE.Group()
  const puddles = [0.4, 2.1, 4.4].map(puddleGeometry)
  const blob = new THREE.SphereGeometry(1, 14, 10)
  const tip = new THREE.ConeGeometry(0.012, 0.024, 10)
  const star = sparkleGeometry()
  const peeBase = new THREE.MeshStandardMaterial({
    color: PEE_COLOR,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: PEE_OPACITY,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  // Transparent from the start: switching it later would not fade it without a new shader
  const poopBase = new THREE.MeshStandardMaterial({
    color: POOP_COLOR,
    roughness: 0.5,
    transparent: true,
  })
  const sparkleBase = new THREE.MeshBasicMaterial({
    color: SPARKLE_COLOR,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  })
  const slots: Slot[] = Array.from({ length: SLOTS }, (_, i) => {
    const pee = new THREE.Mesh(puddles[i % puddles.length]!, peeBase.clone())
    pee.position.y = 0.004
    pee.renderOrder = 1
    pee.receiveShadow = true
    const poopMat = poopBase.clone()
    const poop = new THREE.Group()
    for (const [y, r, squash] of POOP_BLOBS) {
      const b = new THREE.Mesh(blob, poopMat)
      b.position.y = y
      b.scale.set(r, r * squash * 1.6, r)
      b.castShadow = true
      poop.add(b)
    }
    const t = new THREE.Mesh(tip, poopMat)
    t.position.y = 0.09
    t.rotation.z = 0.35
    poop.add(t)
    const sparkle = new THREE.Mesh(star, sparkleBase.clone())
    sparkle.position.y = 0.06
    sparkle.renderOrder = 3
    const g = new THREE.Group()
    g.add(pee, poop, sparkle)
    g.visible = false
    group.add(g)
    return { group: g, pee, poop, poopMat, sparkle, mess: null, age: 0, gone: -1, seen: false }
  })
  scene.add(group)
  let changed = false
  const place = (s: Slot, cam: FixedCamera) => {
    messWorld(cam, s.mess!, s.group.position)
    // Each puddle and poop turned its own way
    s.group.rotation.y = (s.mess!.x * 7.1 + s.mess!.z * 3.7) % (Math.PI * 2)
    // The glint stands up facing the camera, whichever way the mess is turned
    s.sparkle.rotation.y = cam.az - s.group.rotation.y
  }
  const tmp = new THREE.Vector3()

  const layer: MessLayer = {
    group,
    underfoot: [],
    begin() {
      for (const s of slots) s.seen = false
    },
    show(mess, cam) {
      let free: Slot | null = null
      for (const s of slots) {
        if (s.mess === mess && s.gone < 0) {
          s.seen = true
          return
        }
        if (!free && !s.mess) free = s
      }
      if (!free) return
      free.mess = mess
      free.age = 0
      free.gone = -1
      free.seen = true
      free.pee.visible = mess.kind === 'pee'
      free.poop.visible = mess.kind === 'poop'
      place(free, cam)
      free.group.visible = true
      changed = true
    },
    end() {
      for (const s of slots)
        if (s.mess && !s.seen && s.gone < 0) {
          s.gone = 0
          changed = true
        }
      if (!changed) return
      changed = false
      layer.underfoot = slots
        .filter((s) => s.mess && s.gone < 0)
        .map((s) => ({
          x: s.group.position.x,
          z: s.group.position.z,
          r: MESS_R[s.mess!.kind],
        }))
    },
    relayout(cam) {
      for (const s of slots) if (s.mess) place(s, cam)
      changed = true
      layer.end()
    },
    step(dt) {
      for (const s of slots) {
        if (!s.mess) continue
        s.age += dt
        const pee = s.mess.kind === 'pee'
        let k = Math.min(1, s.age / (pee ? SPREAD_TIME : PLOP_TIME))
        k = pee ? 1 - (1 - k) * (1 - k) : k * (2 - k)
        let alpha = 1
        if (s.gone >= 0) {
          s.gone += dt
          const g = Math.min(1, s.gone / CLEAN_TIME)
          k *= 1 - g * g
          alpha = 1 - g
          const sp = s.sparkle
          sp.material.opacity = Math.sin(Math.PI * g)
          sp.scale.setScalar(0.4 + 0.9 * g)
          sp.rotation.z = g * 1.2
          if (g >= 1) {
            s.mess = null
            s.group.visible = false
            sp.material.opacity = 0
            continue
          }
        }
        const size = Math.max(1e-3, pee ? 0.35 + 0.65 * k : k)
        s.pee.scale.setScalar(size)
        s.poop.scale.setScalar(size)
        s.pee.material.opacity = PEE_OPACITY * alpha
        s.poopMat.opacity = alpha
      }
    },
    hit(camera, x, y, w, h) {
      let best: Mess | null = null,
        bestD = HIT_PX
      for (const s of slots) {
        if (!s.mess || s.gone >= 0) continue
        tmp.copy(s.group.position).project(camera)
        const px = ((tmp.x + 1) / 2) * w,
          py = ((1 - tmp.y) / 2) * h
        const d = Math.max(Math.abs(px - x), Math.abs(py - y))
        if (d > bestD) continue
        best = s.mess
        bestD = d
      }
      return best
    },
    dispose() {
      scene.remove(group)
      for (const g of puddles) g.dispose()
      blob.dispose()
      tip.dispose()
      star.dispose()
      for (const s of slots) {
        s.pee.material.dispose()
        s.poopMat.dispose()
        s.sparkle.material.dispose()
      }
      peeBase.dispose()
      poopBase.dispose()
      sparkleBase.dispose()
    },
  }
  return layer
}
