// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { catchUp, cleanMess, createCare, type Mess } from '@/domain/care'
import { cameraPosition, clampPlay, createCamera, fitCamera } from '@/engine/room/camera'
import { computeSpots, furnitureObstacles, inMud, type Spots } from '@/engine/room/furniture'
import {
  CLEAN_TIME,
  createMessLayer,
  HIT_PX,
  messLocal,
  messWorld,
  placeAccident,
} from '@/engine/room/messes'

const HOUR = 3_600_000
const W = 400

const view = (aspect: number) => {
  const cam = fitCamera(createCamera(), aspect)
  const camera = new THREE.PerspectiveCamera(cam.fov, aspect, 0.05, 60)
  cameraPosition(cam, camera.position)
  camera.lookAt(cam.target)
  camera.updateMatrixWorld()
  return { cam, camera, w: W, h: W / aspect }
}

/** Where a floor point shows on a `w` × `h` screen, in pixels from the top left. */
const onScreen = (camera: THREE.Camera, x: number, z: number, w: number, h: number) => {
  const v = new THREE.Vector3(x, 0, z).project(camera)
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, ndc: v }
}

/** A repeatable stream of draws. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

const clearOfFurniture = (spots: Spots, x: number, z: number) =>
  furnitureObstacles(spots).every((c) => Math.hypot(x - c.x, z - c.z) > c.r) &&
  inMud(spots, x, z) === 0

describe('mess coordinates', () => {
  it('keeps a mess in the same place, across and deep, as the frame changes', () => {
    const { cam } = view(0.46)
    const local = messLocal(cam, 0.2, 0.4)
    const out = new THREE.Vector3()
    messWorld(cam, local, out)
    expect(out.x).toBeCloseTo(0.2)
    expect(out.z).toBeCloseTo(0.4)
    // On a wider screen it is still inside the play area
    const wide = view(2.1).cam
    messWorld(wide, { x: 1, z: 1.7 }, out)
    const [x, z] = clampPlay(wide, out.x, out.z)
    expect(Math.hypot(x - out.x, z - out.z)).toBeLessThan(1e-9)
  })
})

describe('accidents while away', () => {
  it.each([0.46, 1, 2.1])(
    'after 8 h at most 2 per puppy, on screen and clear of the furniture (aspect %f)',
    (aspect) => {
      const { cam, camera, w, h } = view(aspect)
      for (const n of [1, 2] as const) {
        const spots = computeSpots(cam, n)
        const random = seeded(7)
        const place = placeAccident(cam, spots, random)
        const start = new Date(2026, 9, 18, 9).getTime()
        const all: THREE.Vector3[] = []
        for (let i = 0; i < n; i++) {
          const care = catchUp(
            createCare(BREEDS.beagle, start),
            BREEDS.beagle,
            start + 8 * HOUR,
            place,
            random,
          )
          expect(care.messes.length).toBeGreaterThan(0)
          expect(care.messes.length).toBeLessThanOrEqual(2)
          all.push(...care.messes.map((m) => messWorld(cam, m, new THREE.Vector3())))
        }
        for (const [i, p] of all.entries()) {
          expect(clearOfFurniture(spots, p.x, p.z)).toBe(true)
          const s = onScreen(camera, p.x, p.z, w, h)
          expect(Math.abs(s.ndc.x)).toBeLessThan(0.95)
          expect(Math.abs(s.ndc.y)).toBeLessThan(0.95)
          // Both puppies' messes stay apart
          for (const q of all.slice(i + 1)) expect(p.distanceTo(q)).toBeGreaterThan(0.25)
        }
      }
    },
  )

  it('gives up rather than piling onto the furniture when there is no room', () => {
    const { cam } = view(1)
    const spots = computeSpots(cam, 1)
    const place = placeAccident(cam, spots, () => 0.5)
    // Every draw lands on the same spot: once taken, there is nowhere else to go
    const first = place('pee', [])
    expect(first).not.toBeNull()
    expect(place('pee', [{ kind: 'pee', ...first!, createdAt: 0 }])).toBeNull()
  })
})

describe('mess layer', () => {
  const pee: Mess = { kind: 'pee', x: 0, z: 0.4, createdAt: 0 }
  const poop: Mess = { kind: 'poop', x: 0.5, z: 0.9, createdAt: 0 }

  const shown = (layer: ReturnType<typeof createMessLayer>) =>
    layer.group.children.filter((c) => c.visible).length

  it('shows what is waiting and nothing else', () => {
    const { cam } = view(1)
    const layer = createMessLayer(new THREE.Scene())
    expect(shown(layer)).toBe(0)
    layer.begin()
    layer.show(pee, cam)
    layer.show(poop, cam)
    layer.end()
    layer.step(1)
    expect(shown(layer)).toBe(2)
    expect(layer.underfoot).toHaveLength(2)
    layer.dispose()
  })

  it('a finger-sized tap on a mess picks it; one off to the side does not', () => {
    const { cam, camera, w, h } = view(0.46)
    const layer = createMessLayer(new THREE.Scene())
    layer.begin()
    layer.show(pee, cam)
    layer.show(poop, cam)
    layer.end()
    expect(HIT_PX * 2).toBeGreaterThanOrEqual(44)
    const out = new THREE.Vector3()
    const p = messWorld(cam, pee, out)
    const s = onScreen(camera, p.x, p.z, w, h)
    expect(layer.hit(camera, s.x, s.y, w, h)).toBe(pee)
    expect(layer.hit(camera, s.x + HIT_PX - 2, s.y, w, h)).toBe(pee)
    expect(layer.hit(camera, s.x + HIT_PX * 2.5, s.y + HIT_PX * 2.5, w, h)).toBeNull()
    layer.dispose()
  })

  it('cleaning one fades it out with a sparkle, and it is gone from the care', () => {
    const { cam, camera, w, h } = view(1)
    const layer = createMessLayer(new THREE.Scene())
    let care = { ...createCare(BREEDS.shiba, 0), messes: [pee, poop] }
    const frame = (dt: number) => {
      layer.begin()
      for (const m of care.messes) layer.show(m, cam)
      layer.end()
      layer.step(dt)
    }
    frame(1)
    const p = messWorld(cam, poop, new THREE.Vector3())
    const s = onScreen(camera, p.x, p.z, w, h)
    const hit = layer.hit(camera, s.x, s.y, w, h)
    expect(hit).toBe(poop)
    care = cleanMess(care, hit!)
    expect(care.messes).toEqual([pee])
    frame(CLEAN_TIME / 2)
    // Still fading, and no longer underfoot or tappable
    expect(shown(layer)).toBeGreaterThanOrEqual(2)
    expect(layer.underfoot).toHaveLength(1)
    expect(layer.hit(camera, s.x, s.y, w, h)).toBeNull()
    frame(CLEAN_TIME)
    expect(shown(layer)).toBe(1)
    layer.dispose()
  })
})
