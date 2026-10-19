import * as THREE from 'three'
import type { ZoneId } from '@/engine/puppy/anatomy'
import { BALL_R } from './ball'

/** A pointer position in screen pixels at `t` milliseconds. */
export interface Sample {
  x: number
  y: number
  t: number
}

/** What a press does, decided when it starts: throw the ball in hand, stroke the puppy, or tap. */
export type PointerMode = 'throw' | 'pet' | 'tap'

export function pointerMode(ballInHand: boolean, onPuppy: boolean): PointerMode {
  if (ballInHand) return 'throw'
  return onPuppy ? 'pet' : 'tap'
}

export type Gesture =
  | { kind: 'throw'; swipe: { vx: number; vy: number } }
  | { kind: 'takeBall' }
  | { kind: 'goTo'; x: number; z: number }
  | { kind: 'puzzle' }
  | { kind: 'none' }

export interface GestureInput {
  mode: PointerMode
  /** Where the press went down. */
  down: { x: number; y: number }
  /** The last few pointer samples, oldest first. */
  samples: Sample[]
  end: Sample
  /** The release lands on a loose ball. */
  onBall: boolean
  /** Where the release ray meets the floor. */
  ground: { x: number; z: number } | null
  /** The puppy is not busy with the ball. */
  free: boolean
}

/** A press that travels less than this is a tap. */
export const TAP_PX = 8
/** Only the last 250 ms of a swipe set its speed. */
const SWIPE_WINDOW = 250

/** Swipe speed in px/s from the recent samples, with `vy` positive upwards. */
export function swipeVelocity(samples: Sample[], end: Sample): { vx: number; vy: number } {
  const recent = samples.findIndex((s) => end.t - s.t < SWIPE_WINDOW)
  const i = Math.max(0, Math.min(recent < 0 ? samples.length - 2 : recent, samples.length - 2))
  const s0 = samples[i] ?? end
  const dt = Math.max(0.016, (end.t - s0.t) / 1000)
  return { vx: (end.x - s0.x) / dt, vy: (s0.y - end.y) / dt }
}

export function classifyGesture(g: GestureInput): Gesture {
  if (g.mode === 'throw') {
    const swipe = swipeVelocity(g.samples, g.end)
    return swipe.vy > 150 ? { kind: 'throw', swipe } : { kind: 'none' }
  }
  const { down } = g
  if (g.mode !== 'tap' || Math.hypot(g.end.x - down.x, g.end.y - down.y) >= TAP_PX)
    return { kind: 'none' }
  if (g.onBall && g.free) return { kind: 'takeBall' }
  if (g.free && g.ground) return { kind: 'goTo', x: g.ground.x, z: g.ground.z }
  return { kind: 'puzzle' }
}

/** Distance along the ray to a sphere, or -1 when it misses. */
export function raySphere(ray: THREE.Ray, c: THREE.Vector3, r: number): number {
  const o = ray.origin,
    d = ray.direction
  const ox = o.x - c.x,
    oy = o.y - c.y,
    oz = o.z - c.z
  const b = ox * d.x + oy * d.y + oz * d.z,
    h = b * b - (ox * ox + oy * oy + oz * oz - r * r)
  return h < 0 ? -1 : -b - Math.sqrt(h)
}

export interface PuppyHit {
  zone: ZoneId
  point: THREE.Vector3
  distance: number
}

/** The game side of the pointer: called with rays already cast from the camera. */
export interface PointerHandlers<H extends PuppyHit = PuppyHit> {
  /** The nearest puppy part under the ray, if any. */
  hit(ray: THREE.Ray): H | null
  ballInHand(): boolean
  /** A loose ball is visible and the ray passes near it. */
  onBall(ray: THREE.Ray): boolean
  free(): boolean
  petStart(hit: H, now: number): void
  petMove(hit: H, now: number, px: number): void
  /** A stroke slid off every puppy; it may come back on with `petMove`. */
  petOff?(): void
  petEnd(): void
  /** The pointer moved: puppies follow it with their eyes. */
  look(ray: THREE.Ray, now: number): void
  /** The mouse left the canvas: attention fades sooner. */
  leave(now: number): void
  gesture(g: Gesture): void
  /**
   * A tap at (x, y) pixels on the `w` × `h` canvas, on the floor or on a puppy (petting is the
   * slide), for the room to use first: true when it did, and it goes no further.
   */
  tap?(x: number, y: number, w: number, h: number): boolean
  /** Whether `tap` would take a tap there: a press on a puppy there pets only once it slides. */
  tapsAt?(x: number, y: number, w: number, h: number): boolean
}

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const MAX_SAMPLES = 8

/** Wires pointer events on the canvas to the handlers; returns the unsubscribe function. */
export function attachPointer<H extends PuppyHit>(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  h: PointerHandlers<H>,
): () => void {
  const raycaster = new THREE.Raycaster(),
    ndc = new THREE.Vector2(),
    hitPoint = new THREE.Vector3()
  let mode: PointerMode | null = null
  let samples: Sample[] = []
  let last = { x: 0, y: 0 },
    start = last
  /** A press on a puppy where a tap is the room's, until it slides into a stroke. */
  let held: H | null = null
  const inCanvas = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect()
    return [x - r.left, y - r.top, r.width, r.height] as const
  }
  const cast = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    return raycaster.ray
  }
  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId)
    const ray = cast(e),
      now = performance.now()
    last = start = { x: e.clientX, y: e.clientY }
    samples = [{ x: e.clientX, y: e.clientY, t: now }]
    if (h.ballInHand()) {
      mode = 'throw'
      return
    }
    const hit = h.hit(ray)
    mode = pointerMode(false, !!hit)
    held = hit && h.tapsAt?.(...inCanvas(e.clientX, e.clientY)) ? hit : null
    if (hit && !held) h.petStart(hit, now / 1000)
    h.look(ray, now / 1000)
    canvas.style.cursor = hit ? 'pointer' : 'default'
  }
  const move = (e: PointerEvent) => {
    const now = performance.now(),
      px = Math.hypot(e.clientX - last.x, e.clientY - last.y)
    last = { x: e.clientX, y: e.clientY }
    samples.push({ x: e.clientX, y: e.clientY, t: now })
    if (samples.length > MAX_SAMPLES) samples.shift()
    const ray = cast(e)
    if (mode === 'throw') return
    if (mode === 'pet' && held && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= TAP_PX) {
      h.petStart(h.hit(ray) ?? held, now / 1000)
      held = null
    }
    if (mode === 'pet' && !held) {
      const hit = h.hit(ray)
      if (hit) h.petMove(hit, now / 1000, px)
      else h.petOff?.()
    }
    h.look(ray, now / 1000)
  }
  const tookTap = (e: PointerEvent) => {
    if (
      (mode !== 'tap' && mode !== 'pet') ||
      !h.tap ||
      Math.hypot(e.clientX - start.x, e.clientY - start.y) >= TAP_PX
    )
      return false
    return h.tap(...inCanvas(e.clientX, e.clientY))
  }
  const up = (e: PointerEvent) => {
    if (mode && !tookTap(e)) {
      const ray = cast(e)
      const ground = ray.intersectPlane(GROUND, hitPoint)
      h.gesture(
        classifyGesture({
          mode,
          down: start,
          samples,
          end: { x: e.clientX, y: e.clientY, t: performance.now() },
          onBall: h.onBall(ray),
          ground: ground && { x: ground.x, z: ground.z },
          free: h.free(),
        }),
      )
    }
    mode = null
    held = null
    h.petEnd()
    canvas.style.cursor = 'default'
  }
  const leave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') h.leave(performance.now() / 1000)
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('pointerleave', leave)
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', up)
    canvas.removeEventListener('pointerleave', leave)
  }
}

/** Ray test against a loose ball, with the generous radius a finger needs. */
export function rayHitsBall(ray: THREE.Ray, pos: THREE.Vector3): boolean {
  return raySphere(ray, pos, BALL_R * 3) > 0
}
