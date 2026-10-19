import * as THREE from 'three'
import { messPenalty, WET_LOSS_PER_SECOND, type Care } from '@/domain/care'
import { damp, type Vec3 } from '@/engine/math'
import type { Anatomy, Tuple3, ZoneId } from '@/engine/puppy/anatomy'
import {
  createDirt,
  DIRT_STEP,
  meanDirt,
  redistributeDirt,
  scrubAt,
  withDirt,
  type Dirt,
  type DirtRest,
} from '@/engine/puppy/dirt'
import { disposeTree, holdTool, type Grip } from './tool'

export type BathPhase = 'off' | 'scrub' | 'rinse' | 'shake' | 'drying'

/** Seconds the water takes to wash the foam away. */
export const RINSE_TIME = 1.5
/** The shake after the rinse: the body rolls ±SHAKE_ROLL at SHAKE_HZ. */
export const SHAKE_TIME = 1.2,
  SHAKE_HZ = 9,
  SHAKE_ROLL = 0.5
/** A wet puppy trembles this fast. */
export const TREMBLE_HZ = 12
export const FOAM_MAX = 192
export const DROP_MAX = 200

/**
 * The finger scrubs this far round it, taking off this much dirt at the middle per unit it
 * travels over the coat: rubbing cleans, a still finger does not.
 */
export const SCRUB_R = 0.16,
  SCRUB_PER_UNIT = 3
/** How wet the lather leaves the fur it is rubbed into. */
const SOAPY = 0.5
/** The dryer's air reaches further than a finger and dries this much per unit travelled. */
const DRY_R = 0.24,
  DRY_PER_UNIT = 5
/** At most this much travel counts in one frame, so a jump across the body is not a stroke. */
export const MAX_TRAVEL = 0.1
/** A blob of foam for every this much travel, and at most a few a frame. */
const FOAM_EVERY = 0.035,
  FOAM_BURST = 4
/** Seconds after the finger last moved that the puppy still feels it rubbing. */
export const RUB_HOLD = 0.3
/** Seconds between drying steps in the air: wetness falls too slowly to need more. */
const AIR_STEP = 1
/** Below this it counts as dry. */
const DRY_ENOUGH = 0.01

/** A sphere the finger can bathe, in the rest pose: the petting zones, the legs and the tail. */
export interface BathSphere {
  zone: ZoneId
  b: string
  c: Tuple3
  r: number
}

const LEGS: [string, string, string][] = [
  ['shL', 'elL', 'wrL'],
  ['shR', 'elR', 'wrR'],
  ['hipL', 'kneeL', 'hockL'],
  ['hipR', 'kneeR', 'hockR'],
]
const TAIL = ['tail0', 'tail1', 'tail2']
const LEG_R = 0.06,
  PAW_Y = 0.04,
  TAIL_R = 0.06

const mid = (a: Tuple3, b: Tuple3): Tuple3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
]

/**
 * Where a bath can reach: every petting zone, the belly even standing, and spheres down each leg
 * to the paw and along the tail. The legs count as the chest in front and the back behind.
 */
export function bathSpheres(A: Pick<Anatomy, 'zones' | 'bones' | 'bi'>): BathSphere[] {
  const pos = (name: string) => A.bones[A.bi[name]!]!.pos
  const out: BathSphere[] = A.zones.map((z) => ({ zone: z.zone, b: z.b, c: z.c, r: z.r }))
  LEGS.forEach(([up, lo, end], i) => {
    const zone: ZoneId = i < 2 ? 'chest' : 'back'
    const a = pos(up),
      k = pos(lo),
      e = pos(end)
    out.push(
      { zone, b: up, c: mid(a, k), r: LEG_R * 1.2 },
      { zone, b: lo, c: mid(k, e), r: LEG_R },
      { zone, b: end, c: [e[0], PAW_Y, e[2] + 0.02], r: LEG_R },
    )
  })
  TAIL.forEach((b, i) => {
    const next = TAIL[i + 1]
    out.push({ zone: 'back', b, c: next ? mid(pos(b), pos(next)) : pos(b), r: TAIL_R })
  })
  return out
}

/** The finger on a bathed or brushed coat: its bone, the point in that bone's frame and at rest. */
export interface CoatTouch {
  bone: THREE.Object3D
  local: Vec3
  rest: Vec3
  /** Which way the finger moves, in the puppy's frame: the dryer blows the fur that way. */
  dir: Vec3
  /** How far it has moved over the coat since the bath last stepped. */
  travel: number
}

/**
 * Where a stroke reaches besides under the finger, in the rest pose. The fixed camera never sees
 * the far side, the belly or the legs behind the near ones, so:
 * - the same spot on the other side is done too;
 * - a stroke low on the flank, between `bellyY` and `flankY` and from `back` to `front`, also
 *   does the belly under it;
 * - one below `flankY`, on a leg or the lower body, also does the same spot at the other end,
 *   front for back: `legSwap − z`.
 */
export interface BathReach {
  bellyY: number
  flankY: number
  back: number
  front: number
  legSwap: number
}

export function bathReach(A: Pick<Anatomy, 'zones' | 'bones' | 'bi'>): BathReach {
  const pos = (name: string) => A.bones[A.bi[name]!]!.pos
  const belly = A.zones.find((z) => z.zone === 'belly')!
  return {
    bellyY: belly.c[1] - belly.r * 0.6,
    flankY: pos('spine')[1],
    back: pos('pelvis')[2] - 0.1,
    front: pos('chest')[2] + 0.08,
    legSwap: pos('shL')[2] + pos('hipL')[2],
  }
}

/** Where the last `reachOf` reaches, in the rest pose. */
export const reached = Array.from({ length: 5 }, () => new THREE.Vector3())

/** The rest points a touch at `p` works on, into `reached`; returns how many. */
export function reachOf(p: Vec3, reach: BathReach | undefined): number {
  reached[0]!.copy(p)
  if (!reach) return 1
  let n = 1
  const side = Math.abs(p.x) >= 0.03
  if (side) reached[n++]!.set(-p.x, p.y, p.z)
  if (p.y >= reach.flankY) return n
  const z = reach.legSwap - p.z
  reached[n++]!.set(p.x, p.y, z)
  if (side) reached[n++]!.set(-p.x, p.y, z)
  if (p.y > reach.bellyY && p.z >= reach.back && p.z <= reach.front)
    reached[n++]!.set(0, reach.bellyY, p.z)
  return n
}

/** A blob of lather stuck to a bone. */
export interface Foam {
  bone: THREE.Object3D | null
  local: Vec3
  size: number
  age: number
}

export interface Bath {
  phase: BathPhase
  /** Seconds in the phase. */
  t: number
  /** The dryer is in hand: the finger dries instead of petting. */
  dryer: boolean
  /** The finger scrubbed or dried it this frame. */
  touched: boolean
  /** A fixed pool: the first `foamN` are on the puppy, and once full the oldest go first. */
  foam: Foam[]
  foamN: number
  foamNext: number
  foamAcc: number
  airAcc: number
  /** 0 to 1: how hard the air blows the fur at `blowAt` (rest pose) towards `blowDir`. */
  blow: number
  blowAt: Vec3
  blowDir: Vec3
  /** Seconds since the finger last moved over the coat. */
  rubT: number
}

export function createBath(): Bath {
  return {
    phase: 'off',
    t: 0,
    dryer: false,
    touched: false,
    foam: Array.from({ length: FOAM_MAX }, () => ({
      bone: null,
      local: new THREE.Vector3(),
      size: 0,
      age: 0,
    })),
    foamN: 0,
    foamNext: 0,
    foamAcc: 0,
    airAcc: 0,
    blow: 0,
    blowAt: new THREE.Vector3(),
    blowDir: new THREE.Vector3(0, 0, -1),
    rubT: RUB_HOLD,
  }
}

function enter(b: Bath, phase: BathPhase) {
  b.phase = phase
  b.t = 0
}

const clearFoam = (b: Bath) => {
  b.foamN = b.foamNext = 0
  for (const f of b.foam) f.bone = null
}

export function beginBath(b: Bath): void {
  enter(b, 'scrub')
  b.dryer = false
}

/** «Aclarar»: only on a lathered puppy. */
export function rinse(b: Bath): boolean {
  if (b.phase !== 'scrub') return false
  enter(b, 'rinse')
  return true
}

/** «Secador»: once rinsed; picked up during the rinse or the shake, it is used straight after. */
export function takeDryer(b: Bath): boolean {
  if (b.phase !== 'rinse' && b.phase !== 'shake' && b.phase !== 'drying') return false
  b.dryer = true
  return true
}

/** «Terminar»: any foam left goes with it; the fur dries by itself from here. */
export function endBath(b: Bath): void {
  enter(b, 'off')
  b.dryer = false
  b.touched = false
  clearFoam(b)
}

/** The puppy's dirt and wetness, one value of each per vertex, and their one GPU copy. */
export interface Coat {
  dirt: Dirt
  wet: Float32Array
  /** Dirt and wetness interleaved, as the fur shader's `coat` attribute reads them. */
  packed: Float32Array
  /** Changed since the last upload, and seconds since then. */
  dirty: boolean
  acc: number
}

const pack = (c: Coat) => {
  const { field } = c.dirt
  for (let i = 0; i < field.length; i++) {
    c.packed[i * 2] = field[i]!
    c.packed[i * 2 + 1] = c.wet[i]!
  }
}

/** The coat for `care`: its saved dirt spread from the paws up, and its wetness all over. */
export function createCoat(rest: DirtRest, care: Care): Coat {
  const dirt = createDirt(rest)
  redistributeDirt(dirt.field, rest, 1 - care.cleanliness - messPenalty(care))
  const n = dirt.field.length
  const coat: Coat = {
    dirt,
    wet: new Float32Array(n).fill(care.wet),
    packed: new Float32Array(n * 2),
    dirty: false,
    acc: 0,
  }
  pack(coat)
  return coat
}

/** Packs a changed coat for upload at most every DIRT_STEP; true when it did. */
export function flushCoat(c: Coat, dt: number): boolean {
  c.acc += dt
  if (!c.dirty || c.acc < DIRT_STEP) return false
  pack(c)
  c.dirty = false
  c.acc = 0
  return true
}

export const meanWet: (wet: Float32Array) => number = meanDirt

/** The care with the coat's cleanliness and its mean wetness: what is saved of a bath. */
export const withCoat = (care: Care, coat: Coat): Care => ({
  ...withDirt(care, coat.dirt.field),
  wet: meanWet(coat.wet),
})

/** Wets the fur within `radius` of `point` to `level` at the middle, less towards the edge. */
function soakAt(
  wet: Float32Array,
  rest: DirtRest,
  point: Pick<Vec3, 'x' | 'y' | 'z'>,
  radius: number,
  level: number,
): boolean {
  const p = rest.position,
    r2 = radius * radius
  let changed = false
  for (let i = 0; i < wet.length; i++) {
    const dx = p[i * 3]! - point.x,
      dy = p[i * 3 + 1]! - point.y,
      dz = p[i * 3 + 2]! - point.z,
      d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= r2) continue
    const w = level * (1 - d2 / r2)
    if (wet[i]! >= w) continue
    wet[i] = w
    changed = true
  }
  return changed
}

/** The dryer's air: like scrubbing, but softer at the edge of a wider patch. */
function dryAt(
  wet: Float32Array,
  rest: DirtRest,
  point: Pick<Vec3, 'x' | 'y' | 'z'>,
  amount: number,
): boolean {
  const p = rest.position,
    r2 = DRY_R * DRY_R
  let changed = false
  for (let i = 0; i < wet.length; i++) {
    if (wet[i]! <= 0) continue
    const dx = p[i * 3]! - point.x,
      dy = p[i * 3 + 1]! - point.y,
      dz = p[i * 3 + 2]! - point.z,
      d2 = dx * dx + dy * dy + dz * dz
    if (d2 >= r2) continue
    wet[i] = Math.max(0, wet[i]! - amount * (1 - d2 / r2))
    changed = true
  }
  return changed
}

function airDry(wet: Float32Array, amount: number): boolean {
  let changed = false
  for (let i = 0; i < wet.length; i++) {
    const w = wet[i]!
    if (w <= 0) continue
    const left = w - amount
    wet[i] = left < DRY_ENOUGH ? 0 : left
    changed = true
  }
  return changed
}

function addFoam(b: Bath, touch: CoatTouch, random: () => number) {
  let f: Foam
  if (b.foamN < FOAM_MAX) f = b.foam[b.foamN++]!
  else {
    f = b.foam[b.foamNext]!
    b.foamNext = (b.foamNext + 1) % FOAM_MAX
  }
  f.bone = touch.bone
  f.local.set(
    touch.local.x + (random() - 0.5) * 0.05,
    touch.local.y + (random() - 0.5) * 0.05,
    touch.local.z + (random() - 0.5) * 0.05,
  )
  f.size = 0.6 + 0.4 * random()
  f.age = 0
}

export interface BathInput {
  coat: Coat
  /** The finger on the puppy, or null. Its travel is used up by the step. */
  touch: CoatTouch | null
  /** Where else a stroke reaches; without it, only under the finger. */
  reach?: BathReach
  random?: () => number
}

/**
 * One frame of the bath. Scrubbing takes the dirt off under the finger and lathers it; the rinse
 * washes the foam off over RINSE_TIME and soaks the coat, then the puppy shakes; with the dryer
 * the finger dries where it passes and blows the fur along. Out of the rinse, the coat dries by
 * itself in about 10 min. Returns whether the coat changed.
 */
export function stepBath(b: Bath, input: BathInput, dt: number): boolean {
  const { coat, touch } = input
  const { rest } = coat.dirt
  b.t += dt
  for (let i = 0; i < b.foamN; i++) b.foam[i]!.age += dt
  let changed = false
  const travel = touch ? Math.min(MAX_TRAVEL, touch.travel) : 0
  if (touch) touch.travel = 0
  b.rubT = travel > 0 ? 0 : b.rubT + dt
  const drying = b.phase === 'drying' && b.dryer && !!touch
  const n = touch && travel > 0 ? reachOf(touch.rest, input.reach) : 0
  b.touched = !!touch && b.rubT < RUB_HOLD && (b.phase === 'scrub' || drying)
  if (b.phase === 'scrub' && touch && travel > 0) {
    for (let i = 0; i < n; i++) {
      const at = reached[i]!
      changed = scrubAt(coat.dirt.field, rest, at, SCRUB_R, SCRUB_PER_UNIT * travel) || changed
      changed = soakAt(coat.wet, rest, at, SCRUB_R, SOAPY) || changed
    }
    b.foamAcc = Math.min(b.foamAcc + travel, FOAM_EVERY * FOAM_BURST)
    for (; b.foamAcc >= FOAM_EVERY; b.foamAcc -= FOAM_EVERY)
      addFoam(b, touch, input.random ?? Math.random)
  } else if (b.phase === 'rinse') {
    const level = Math.min(1, b.t / RINSE_TIME)
    for (let i = 0; i < coat.wet.length; i++) if (coat.wet[i]! < level) coat.wet[i] = level
    changed = true
    if (b.t >= RINSE_TIME) {
      clearFoam(b)
      enter(b, 'shake')
    }
  } else if (b.phase === 'shake' && b.t >= SHAKE_TIME) enter(b, 'drying')
  if (drying)
    for (let i = 0; i < n; i++)
      changed = dryAt(coat.wet, rest, reached[i]!, DRY_PER_UNIT * travel) || changed
  b.blow = damp(b.blow, drying ? 1 : 0, 8, dt)
  if (drying) {
    b.blowAt.copy(touch.rest)
    b.blowDir.copy(touch.dir)
  }
  if (b.phase !== 'rinse') {
    b.airAcc += dt
    if (b.airAcc >= AIR_STEP) {
      changed = airDry(coat.wet, WET_LOSS_PER_SECOND * b.airAcc) || changed
      b.airAcc = 0
    }
  }
  if (changed) coat.dirty = true
  return changed
}

/** What the layer needs of a puppy in the room: its bath, where it can be bathed, the finger. */
export interface BathShown {
  bath: Bath
  bathZones: readonly { bone: THREE.Object3D; off: Vec3; r: number }[]
  coatTouch: CoatTouch | null
  group: THREE.Object3D
}

export interface BathLayer {
  foam: THREE.InstancedMesh
  drops: THREE.InstancedMesh
  /** After the puppies' bones are posed: lays the foam on them, rains, splashes and blows. */
  sync(shown: readonly BathShown[], dt: number, camera: Vec3): void
  dispose(): void
}

const FOAM_R = 0.026,
  FOAM_GROW = 0.12,
  DROP_R = 0.016,
  DROP_LIFE = 1.4,
  GRAVITY = 6
/** Shaken off, drops fly out at most this fast, and up a little: they land round the puppy. */
const SPRAY_SPEED = 0.75,
  SPRAY_UP = 0.7
/** Bath spheres a puppy has at most: shower drops are tested against these. */
const MAX_SPHERES = 64
/** Drops a second from the shower while rinsing, and off the coat while shaking. */
const RAIN = 150,
  SPRAY = 220
/** The shower is this high and this wide over the puppy. */
const SHOWER_Y = 1.15,
  SHOWER_HALF = 0.22

/**
 * Where the dryer is held from the spot it dries, and how big it is: up and to the left, clear of
 * a finger coming from below on the right.
 */
const DRYER_GRIP: Grip = { back: 0.12, side: -0.24, up: 0.14 },
  DRYER_SCALE = 2.5
const ONE = new THREE.Quaternion()
const tmp = new THREE.Vector3(),
  tmp2 = new THREE.Vector3(),
  scl = new THREE.Vector3(),
  mat = new THREE.Matrix4()

/** A small hair dryer with its nozzle along +z and a few streaks of air in front of it. */
function makeDryer() {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#7cc6b4', roughness: 0.45 }),
    darkMat = new THREE.MeshStandardMaterial({ color: '#3b3f46', roughness: 0.6 })
  const along = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2)
  const body = new THREE.Mesh(along(new THREE.CylinderGeometry(0.034, 0.03, 0.11, 20)), bodyMat)
  body.position.z = -0.02
  const back = new THREE.Mesh(along(new THREE.CylinderGeometry(0.031, 0.031, 0.01, 20)), darkMat)
  back.position.z = -0.08
  const nozzle = new THREE.Mesh(along(new THREE.CylinderGeometry(0.022, 0.027, 0.04, 16)), darkMat)
  nozzle.position.z = 0.055
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.085, 12), bodyMat)
  handle.position.set(0, -0.055, -0.035)
  handle.rotation.x = -0.25
  group.add(body, back, nozzle, handle)
  const streakGeo = along(new THREE.CylinderGeometry(0.0025, 0.0025, 0.07, 5))
  const streaks = Array.from({ length: 4 }, (_, i) => {
    const m = new THREE.Mesh(
      streakGeo,
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    )
    const a = (i / 4) * Math.PI * 2 + 0.4
    m.position.set(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0)
    group.add(m)
    return m
  })
  group.scale.setScalar(DRYER_SCALE)
  group.visible = false
  return { group, streaks }
}

/** Foam, water drops and the hair dryer for the puppies' baths: fixed pools, nothing per frame. */
export function createBathLayer(scene: THREE.Scene, random: () => number = Math.random): BathLayer {
  const foam = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(FOAM_R, 1),
    new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#3c3f48', roughness: 0.5 }),
    FOAM_MAX,
  )
  const drops = new THREE.InstancedMesh(
    new THREE.SphereGeometry(DROP_R, 8, 6),
    new THREE.MeshStandardMaterial({
      color: '#cfe8ff',
      roughness: 0.08,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
    DROP_MAX,
  )
  for (const m of [foam, drops]) {
    m.count = 0
    m.visible = false
    m.frustumCulled = false
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(m)
  }
  const dryer = makeDryer()
  scene.add(dryer.group)

  const pos = new Float32Array(DROP_MAX * 3),
    vel = new Float32Array(DROP_MAX * 3),
    life = new Float32Array(DROP_MAX),
    /** Shower drops stop on the coat; the ones shaken off fly clear of it. */
    shower = new Uint8Array(DROP_MAX)
  let cursor = 0,
    spawnAcc = 0,
    clock = 0
  const spawn = (
    rain: boolean,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ) => {
    let i = cursor
    for (let n = 0; n < DROP_MAX && life[i]! > 0; n++) i = (i + 1) % DROP_MAX
    cursor = (i + 1) % DROP_MAX
    const j = i * 3
    pos[j] = x
    pos[j + 1] = y
    pos[j + 2] = z
    vel[j] = vx
    vel[j + 1] = vy
    vel[j + 2] = vz
    life[i] = DROP_LIFE
    shower[i] = rain ? 1 : 0
  }
  const unit = (out: Vec3) => {
    do out.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
    while (out.lengthSq() > 1 || out.lengthSq() < 1e-4)
    return out.normalize()
  }
  /** World centre of a bath zone, into `out`. */
  const centre = (z: BathShown['bathZones'][number], out: Vec3) =>
    z.bone.localToWorld(out.copy(z.off))
  const spheres = new Float32Array(MAX_SPHERES * 4)
  /** Inside one of the first `n` spheres in `spheres`. */
  const onCoat = (n: number, p: Vec3) => {
    for (let i = 0; i < n * 4; i += 4) {
      const dx = p.x - spheres[i]!,
        dy = p.y - spheres[i + 1]!,
        dz = p.z - spheres[i + 2]!
      if (dx * dx + dy * dy + dz * dz < spheres[i + 3]!) return true
    }
    return false
  }

  return {
    foam,
    drops,
    sync(shown, dt, camera) {
      clock += dt
      let n = 0
      for (const s of shown) {
        const b = s.bath
        const fade = b.phase === 'rinse' ? Math.max(0, 1 - b.t / RINSE_TIME) : 1
        for (let i = 0; i < b.foamN; i++) {
          const f = b.foam[i]!
          if (!f.bone) continue
          const k =
            fade * f.size * Math.min(1, f.age / FOAM_GROW) * (1 + 0.06 * Math.sin(f.age * 3 + i))
          f.bone.localToWorld(tmp.copy(f.local))
          foam.setMatrixAt(n++, mat.compose(tmp, ONE, scl.setScalar(Math.max(k, 1e-4))))
        }
        const rate = b.phase === 'rinse' ? RAIN : b.phase === 'shake' ? SPRAY : 0
        if (!rate || !s.bathZones.length) continue
        spawnAcc += rate * dt
        for (; spawnAcc >= 1; spawnAcc--) {
          if (b.phase === 'rinse') {
            const g = s.group.position
            spawn(
              true,
              g.x + (random() * 2 - 1) * SHOWER_HALF,
              SHOWER_Y,
              g.z + (random() * 2 - 1) * SHOWER_HALF,
              0,
              -2.2 - random() * 0.6,
              0,
            )
            continue
          }
          const zone = s.bathZones[Math.floor(random() * s.bathZones.length)]!
          const d = unit(tmp)
          if (d.y < -0.3) d.y = -d.y
          const c = centre(zone, tmp2)
          const speed = SPRAY_SPEED * (0.5 + 0.5 * random())
          spawn(
            false,
            c.x + d.x * zone.r,
            c.y + d.y * zone.r,
            c.z + d.z * zone.r,
            d.x * speed,
            d.y * speed + SPRAY_UP,
            d.z * speed,
          )
        }
      }
      foam.count = n
      foam.visible = n > 0
      if (n) foam.instanceMatrix.needsUpdate = true

      // Shower drops stop on the coat of the puppy being rinsed: its spheres, placed once
      let rinsed = 0
      for (const s of shown) {
        if (s.bath.phase !== 'rinse') continue
        for (const zone of s.bathZones) {
          if (rinsed === MAX_SPHERES) break
          centre(zone, tmp2).toArray(spheres, rinsed * 4)
          spheres[rinsed++ * 4 + 3] = zone.r * zone.r
        }
        break
      }

      let live = 0
      for (let i = 0; i < DROP_MAX; i++) {
        if (life[i]! <= 0) continue
        life[i]! -= dt
        const j = i * 3
        vel[j + 1]! -= GRAVITY * dt
        pos[j]! += vel[j]! * dt
        pos[j + 1]! += vel[j + 1]! * dt
        pos[j + 2]! += vel[j + 2]! * dt
        tmp.set(pos[j]!, pos[j + 1]!, pos[j + 2]!)
        if (tmp.y < 0.01 || life[i]! <= 0 || (shower[i] && onCoat(rinsed, tmp))) {
          life[i] = 0
          continue
        }
        drops.setMatrixAt(live++, mat.compose(tmp, ONE, scl.set(1, 1.5, 1)))
      }
      drops.count = live
      drops.visible = live > 0
      if (live) drops.instanceMatrix.needsUpdate = true

      let t: CoatTouch | null = null
      for (const s of shown) if (s.bath.phase === 'drying' && s.bath.dryer) t ??= s.coatTouch
      dryer.group.visible = !!t
      if (t) {
        holdTool(dryer.group, t.bone.localToWorld(tmp.copy(t.local)), camera, DRYER_GRIP)
        for (let i = 0; i < dryer.streaks.length; i++) {
          const m = dryer.streaks[i]!,
            u = (clock * 3 + i / dryer.streaks.length) % 1
          m.position.z = 0.09 + u * 0.09
          m.material.opacity = 0.55 * Math.sin(u * Math.PI)
        }
      }
    },
    dispose() {
      scene.remove(foam, drops, dryer.group)
      for (const m of [foam, drops]) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
        m.dispose()
      }
      disposeTree(dryer.group)
    },
  }
}
