import * as THREE from 'three'
import type { FurParams } from '@/domain/breeds'
import { dull, groom, type Care } from '@/domain/care'
import type { Vec3 } from '@/engine/math'
import { brushAt, DIRT_STEP } from '@/engine/puppy/dirt'
import {
  MAX_TRAVEL,
  reached,
  reachOf,
  RUB_HOLD,
  SCRUB_PER_UNIT,
  SCRUB_R,
  type BathReach,
  type Coat,
  type CoatTouch,
} from './bath'
import { disposeTree, holdTool, type Grip } from './tool'

export const HEART_MAX = 24

/** Shine and happiness per unit of finger travel with the grain; a cuddlier puppy gains more. */
const SHINE_PER_UNIT = 0.25,
  JOY_PER_UNIT = 0.03
/** A heart for every this much travel with the grain, and at most a few a frame. */
const HEART_EVERY = 0.2,
  HEART_BURST = 2
/**
 * How much a stroke counts by how well it goes with the grain (the cosine between the two): fully
 * from GRAIN_FULL, down to AGAINST from GRAIN_NONE. With the grain enough to FEEL, the puppy
 * enjoys it.
 */
const GRAIN_NONE = -0.1,
  GRAIN_FULL = 0.45,
  AGAINST = 0.08,
  FEEL = 0.5
/** A coat wetter than this has no dry dirt to knock off. */
const DAMP = 0.1
/** Seconds between writes of the fading shine to the care, with no brushing to write. */
const FADE_STEP = 10

export interface Brush {
  /** The brush is in hand: the finger brushes instead of petting. */
  on: boolean
  /** Brushed with the grain just now: the puppy feels it. */
  touched: boolean
  /** The side the brush is on: +1 its left, −1 its right. */
  side: number
  /** Seconds since the last stroke with the grain. */
  rubT: number
  /** Shine and happiness earned and not yet in the care. */
  shine: number
  joy: number
  heartAcc: number
  /** Hearts earned and not yet shown: the layer takes them. */
  hearts: number
  /** Seconds since the care was last written. */
  acc: number
}

export const createBrush = (): Brush => ({
  on: false,
  touched: false,
  side: 1,
  rubT: RUB_HOLD,
  shine: 0,
  joy: 0,
  heartAcc: 0,
  hearts: 0,
  acc: 0,
})

export const beginBrush = (b: Brush): void => void (b.on = true)

export function endBrush(b: Brush): void {
  b.on = b.touched = false
  b.heartAcc = b.hearts = 0
}

/** The way a breed's fur lies, in the puppy's frame: back towards the tail and down, as it combs. */
export const grainOf = (fur: Pick<FurParams, 'comb' | 'droop'>): THREE.Vector3 =>
  new THREE.Vector3(0, -fur.droop, -fur.comb).normalize()

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** How much a stroke along `dir` counts: 1 with the grain, AGAINST against it. */
const withGrain = (dir: Vec3, grain: Vec3) =>
  AGAINST + (1 - AGAINST) * smoothstep(GRAIN_NONE, GRAIN_FULL, dir.dot(grain))

export interface BrushInput {
  coat: Coat
  /** The finger on the puppy, or null. While brushing, its travel is used up by the step. */
  touch: CoatTouch | null
  reach?: BathReach
  /** `grainOf` its breed's fur. */
  grain: Vec3
  care: Care
  /** Its persona's cuddliness, 0 to 1. */
  cuddly: number
}

/**
 * One frame of the brush: each stroke adds shine and happiness, and a heart now and then, as far
 * as the finger travels and the more the better it goes with the grain; it knocks a little dry
 * dirt off too. Brushing or not, the shine wears off. Returns the care, the same object until
 * there is something to write, which is at most every DIRT_STEP.
 */
export function stepBrush(b: Brush, input: BrushInput, dt: number): Care {
  const { coat, touch } = input
  const care = input.care
  b.acc += dt
  let felt = false
  if (b.on && touch) {
    const travel = Math.min(MAX_TRAVEL, touch.travel)
    touch.travel = 0
    if (travel > 0) {
      const k = withGrain(touch.dir, input.grain),
        gain = travel * k
      felt = k >= FEEL
      b.shine += SHINE_PER_UNIT * gain
      b.joy += JOY_PER_UNIT * (0.5 + input.cuddly) * gain
      if (felt) {
        b.side = touch.rest.x >= 0 ? 1 : -1
        b.heartAcc = Math.min(b.heartAcc + gain, HEART_EVERY * HEART_BURST)
        for (; b.heartAcc >= HEART_EVERY; b.heartAcc -= HEART_EVERY) b.hearts++
      }
      if (care.wet < DAMP) {
        const { field, rest } = coat.dirt
        let changed = false
        for (let i = 0, n = reachOf(touch.rest, input.reach); i < n; i++)
          changed = brushAt(field, rest, reached[i]!, SCRUB_R, SCRUB_PER_UNIT * gain) || changed
        if (changed) coat.dirty = true
      }
    }
  }
  b.rubT = felt ? 0 : b.rubT + dt
  b.touched = b.on && !!touch && b.rubT < RUB_HOLD
  const earned = b.shine > 0 || b.joy > 0
  if (b.acc < (earned ? DIRT_STEP : FADE_STEP)) return care
  let out = dull(care, b.acc)
  if (earned) out = groom(out, b.shine, b.joy)
  b.shine = b.joy = b.acc = 0
  return out
}

/** What the layer needs of a puppy in the room: its brush and the finger on it. */
export interface BrushShown {
  brush: Brush
  coatTouch: CoatTouch | null
}

export interface BrushLayer {
  hearts: THREE.InstancedMesh
  /** The brush in hand. */
  tool: THREE.Object3D
  /** After the puppies' bones are posed: floats the hearts earned and holds the brush. */
  sync(shown: readonly BrushShown[], dt: number, camera: THREE.Camera): void
  dispose(): void
}

/** Hearts rise this fast for this long, popping in and shrinking away at the end. */
const HEART_SIZE = 0.08,
  HEART_LIFE = 1.1,
  HEART_RISE = 0.24,
  HEART_POP = 0.12,
  HEART_GO = 0.35,
  HEART_OUT = 0.1
/** Close to the finger, a little up and to the left, the bristles towards the spot. */
const BRUSH_GRIP: Grip = { back: 0.03, side: -0.05, up: 0.05 },
  BRUSH_SCALE = 1.6

/** A flat heart in the xy plane, about a unit across. */
function heartGeometry(): THREE.ShapeGeometry {
  // The room's heart, from its 128 px drawing
  const p = (x: number, y: number): [number, number] => [(x - 64) / 96, (64 - y) / 96]
  const s = new THREE.Shape()
  s.moveTo(...p(64, 112))
  s.bezierCurveTo(...p(10, 72), ...p(8, 30), ...p(38, 22))
  s.bezierCurveTo(...p(54, 18), ...p(62, 30), ...p(64, 40))
  s.bezierCurveTo(...p(66, 30), ...p(74, 18), ...p(90, 22))
  s.bezierCurveTo(...p(120, 30), ...p(118, 72), ...p(64, 112))
  return new THREE.ShapeGeometry(s, 8)
}

/** A small wooden brush with its bristles along +z and the handle back and up from them. */
function makeBrush(): THREE.Group {
  const g = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: '#c98f5a', roughness: 0.6 }),
    bristle = new THREE.MeshStandardMaterial({ color: '#f4ead8', roughness: 0.85 })
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.035, 0.016), wood)
  const tufts = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.028, 0.018), bristle)
  tufts.position.z = 0.016
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.07, 10), wood)
  handle.rotation.z = Math.PI / 2
  handle.position.set(0.07, 0.006, -0.004)
  g.add(back, tufts, handle)
  g.scale.setScalar(BRUSH_SCALE)
  g.visible = false
  return g
}

const tmp = new THREE.Vector3(),
  toCam = new THREE.Vector3(),
  scl = new THREE.Vector3(),
  mat = new THREE.Matrix4()

/** The hearts brushing earns and the brush in hand: a fixed pool and one model, nothing per frame. */
export function createBrushLayer(
  scene: THREE.Scene,
  random: () => number = Math.random,
): BrushLayer {
  const hearts = new THREE.InstancedMesh(
    heartGeometry(),
    // Over everything: they rise out of the coat, not from behind it
    new THREE.MeshBasicMaterial({
      color: '#e8606a',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
    HEART_MAX,
  )
  hearts.count = 0
  hearts.visible = false
  hearts.renderOrder = 100
  hearts.frustumCulled = false
  hearts.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  const tool = makeBrush()
  scene.add(hearts, tool)

  const pos = new Float32Array(HEART_MAX * 3),
    age = new Float32Array(HEART_MAX).fill(HEART_LIFE)
  let cursor = 0
  /** Out of the fur towards the camera, so the coat does not hide it. */
  const spawn = (at: Vec3, camera: Vec3) => {
    toCam.copy(camera).sub(at).setLength(HEART_OUT)
    let i = cursor
    for (let n = 0; n < HEART_MAX && age[i]! < HEART_LIFE; n++) i = (i + 1) % HEART_MAX
    cursor = (i + 1) % HEART_MAX
    pos[i * 3] = at.x + toCam.x + (random() - 0.5) * 0.14
    pos[i * 3 + 1] = at.y + toCam.y + 0.04
    pos[i * 3 + 2] = at.z + toCam.z + (random() - 0.5) * 0.14
    age[i] = 0
  }

  return {
    hearts,
    tool,
    sync(shown, dt, camera) {
      let held: CoatTouch | null = null
      for (const s of shown) {
        const t = s.coatTouch
        if (s.brush.on && t) held ??= t
        if (t)
          for (; s.brush.hearts > 0; s.brush.hearts--)
            spawn(t.bone.localToWorld(tmp.copy(t.local)), camera.position)
        s.brush.hearts = 0
      }
      let n = 0
      for (let i = 0; i < HEART_MAX; i++) {
        if (age[i]! >= HEART_LIFE) continue
        const a = (age[i]! += dt)
        if (a >= HEART_LIFE) continue
        pos[i * 3 + 1]! += HEART_RISE * dt
        const k = Math.min(1, a / HEART_POP) * Math.min(1, (HEART_LIFE - a) / HEART_GO)
        tmp.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!)
        hearts.setMatrixAt(
          n++,
          mat.compose(tmp, camera.quaternion, scl.setScalar(HEART_SIZE * Math.max(k, 1e-4))),
        )
      }
      hearts.count = n
      hearts.visible = n > 0
      if (n) hearts.instanceMatrix.needsUpdate = true

      tool.visible = !!held
      if (held)
        holdTool(tool, held.bone.localToWorld(tmp.copy(held.local)), camera.position, BRUSH_GRIP)
    },
    dispose() {
      scene.remove(hearts, tool)
      hearts.geometry.dispose()
      ;(hearts.material as THREE.Material).dispose()
      hearts.dispose()
      disposeTree(tool)
    },
  }
}
