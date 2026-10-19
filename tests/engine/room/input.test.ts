// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  attachPointer,
  classifyGesture,
  pointerMode,
  type Gesture,
  type PointerHandlers,
  type Sample,
} from '@/engine/room/input'

/** A straight drag from (x0, y0) to (x1, y1) over `ms`, sampled every 16 ms. */
function drag(x0: number, y0: number, x1: number, y1: number, ms: number): Sample[] {
  const out: Sample[] = []
  for (let t = 0; t <= ms; t += 16) {
    const k = t / ms
    out.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, t })
  }
  out.push({ x: x1, y: y1, t: ms })
  return out
}

const tap = (onBall: boolean) => {
  const samples = drag(200, 400, 203, 404, 90)
  return classifyGesture({
    mode: pointerMode(false, false),
    down: samples[0]!,
    samples,
    end: samples.at(-1)!,
    onBall,
    ground: { x: 0.3, z: 0.6 },
    free: true,
  })
}

describe('classifyGesture', () => {
  it('throws the ball on an upward swipe of 200 px in 300 ms with the ball in hand', () => {
    const samples = drag(200, 600, 200, 400, 300)
    const g = classifyGesture({
      mode: pointerMode(true, false),
      down: samples[0]!,
      samples,
      end: samples.at(-1)!,
      onBall: false,
      ground: null,
      free: false,
    })
    expect(g.kind).toBe('throw')
    if (g.kind === 'throw') expect(g.swipe.vy).toBeGreaterThan(150)
  })

  it('does not throw on a downward swipe', () => {
    const samples = drag(200, 400, 200, 600, 300)
    const g = classifyGesture({
      mode: 'throw',
      down: samples[0]!,
      samples,
      end: samples.at(-1)!,
      onBall: false,
      ground: null,
      free: false,
    })
    expect(g.kind).toBe('none')
  })

  it('sends the puppy to a floor tap under 8 px away from the puppy', () => {
    expect(tap(false)).toEqual({ kind: 'goTo', x: 0.3, z: 0.6 })
  })

  it('picks up a ball lying on the floor when the tap lands on it', () => {
    expect(tap(true)).toEqual({ kind: 'takeBall' })
  })

  it('pets instead of tapping when the press starts on the puppy', () => {
    expect(pointerMode(false, true)).toBe('pet')
  })
})

describe('attachPointer', () => {
  /** A canvas stand-in 400 × 800 at (10, 20) that takes pointer events. */
  const fakeCanvas = () =>
    Object.assign(new EventTarget(), {
      style: { cursor: '' },
      setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 800 }),
    }) as unknown as HTMLCanvasElement
  const press = (canvas: HTMLCanvasElement, type: string, x: number, y: number) => {
    const e = Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1 })
    canvas.dispatchEvent(e)
  }
  const handlers = (
    tap: PointerHandlers['tap'],
    gestures: Gesture[],
    more: Partial<PointerHandlers> = {},
  ): PointerHandlers => ({
    hit: () => null,
    ballInHand: () => false,
    onBall: () => false,
    free: () => true,
    petStart() {},
    petMove() {},
    petEnd() {},
    look() {},
    leave() {},
    gesture: (g) => void gestures.push(g),
    ...(tap && { tap }),
    ...more,
  })
  const camera = new THREE.PerspectiveCamera(30, 0.5, 0.05, 60)
  camera.position.set(0, 2, 3)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()

  it('lets the room take a tap first, in canvas pixels, before it sends the puppy there', () => {
    const canvas = fakeCanvas(),
      gestures: Gesture[] = [],
      taps: number[][] = []
    const off = attachPointer(
      canvas,
      camera,
      handlers((x, y, w, h) => {
        taps.push([x, y, w, h])
        return true
      }, gestures),
    )
    press(canvas, 'pointerdown', 210, 620)
    press(canvas, 'pointerup', 212, 621)
    expect(taps).toEqual([[202, 601, 400, 800]])
    expect(gestures).toEqual([])
    off()
  })

  it('a tap the room does not take is a gesture as before, and a drag never asks', () => {
    const canvas = fakeCanvas(),
      gestures: Gesture[] = []
    let asked = 0
    attachPointer(
      canvas,
      camera,
      handlers(() => {
        asked++
        return false
      }, gestures),
    )
    press(canvas, 'pointerdown', 210, 620)
    press(canvas, 'pointerup', 212, 621)
    expect(asked).toBe(1)
    expect(gestures.map((g) => g.kind)).toEqual(['goTo'])
    press(canvas, 'pointerdown', 210, 620)
    press(canvas, 'pointerup', 260, 621)
    expect(asked).toBe(1)
  })

  it('a tap that starts on the puppy still cleans the mess under the finger, without a pat', () => {
    const canvas = fakeCanvas(),
      events: string[] = []
    const onPuppy = { zone: 'back' as const, point: new THREE.Vector3(), distance: 1 }
    let mess = true
    attachPointer(
      canvas,
      camera,
      handlers(
        () => {
          events.push('tap')
          return mess
        },
        [],
        {
          hit: () => onPuppy,
          tapsAt: (x, y, w, h) => {
            events.push(`tapsAt:${[x, y, w, h].join(',')}`)
            return mess
          },
          petStart: () => void events.push('petStart'),
          petMove: () => void events.push('petMove'),
          petEnd: () => void events.push('petEnd'),
        },
      ),
    )
    press(canvas, 'pointerdown', 210, 620)
    press(canvas, 'pointermove', 213, 622)
    press(canvas, 'pointerup', 211, 621)
    expect(events).toEqual(['tapsAt:200,600,400,800', 'tap', 'petEnd'])
    // A slide is a pat from where it starts and never asks; a tap with no mess there is the puppy's
    events.length = 0
    press(canvas, 'pointerdown', 210, 620)
    press(canvas, 'pointermove', 240, 620)
    press(canvas, 'pointerup', 260, 620)
    expect(events.slice(1)).toEqual(['petStart', 'petMove', 'petEnd'])
    events.length = 0
    mess = false
    press(canvas, 'pointerdown', 210, 620)
    press(canvas, 'pointerup', 211, 621)
    expect(events.slice(1)).toEqual(['petStart', 'tap', 'petEnd'])
  })

  it('says when a stroke slides off the puppy, and keeps following it back on', () => {
    const canvas = fakeCanvas(),
      events: string[] = []
    const onPuppy = { zone: 'back' as const, point: new THREE.Vector3(), distance: 1 }
    attachPointer(
      canvas,
      camera,
      handlers(undefined, [], {
        hit: (ray) => (ray.direction.x < 0 ? onPuppy : null),
        petStart: () => void events.push('petStart'),
        petMove: () => void events.push('petMove'),
        petOff: () => void events.push('petOff'),
        petEnd: () => void events.push('petEnd'),
      }),
    )
    press(canvas, 'pointerdown', 150, 420)
    press(canvas, 'pointermove', 180, 420)
    press(canvas, 'pointermove', 380, 420)
    press(canvas, 'pointermove', 160, 420)
    press(canvas, 'pointerup', 160, 420)
    expect(events).toEqual(['petStart', 'petMove', 'petOff', 'petMove', 'petEnd'])
  })
})
