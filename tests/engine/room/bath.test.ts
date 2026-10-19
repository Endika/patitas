// @vitest-environment node
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { createCare, type Care } from '@/domain/care'
import type { Anatomy } from '@/engine/puppy/anatomy'
import { dirtRest, meanDirt, type DirtRest } from '@/engine/puppy/dirt'
import { buildPuppyGeometry } from '@/engine/puppy/geometry'
import {
  bathSpheres,
  beginBath,
  createBath,
  createBathLayer,
  createCoat,
  DROP_MAX,
  endBath,
  flushCoat,
  FOAM_MAX,
  rinse,
  RINSE_TIME,
  SHAKE_TIME,
  stepBath,
  takeDryer,
  withCoat,
  type Bath,
  type BathTouch,
  type Coat,
} from '@/engine/room/bath'

const DT = 1 / 60
let A: Anatomy
let rest: DirtRest

beforeAll(() => {
  const built = buildPuppyGeometry(BREEDS.shiba)
  A = built.anatomy
  const g = built.geometry
  rest = dirtRest(g.attributes.position!.array, g.attributes.normal!.array, A.nose.c)
}, 60_000)

/** Every axis and every diagonal: a finger going all round. */
const DIRS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  ...[-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) => [-1, 1].map((z): [number, number, number] => [x, y, z])),
  ),
]

/** Points on the surface of every sphere the finger can bathe, all round each one. */
const allOver = () =>
  bathSpheres(A).flatMap((s) =>
    DIRS.map(([x, y, z]) =>
      new THREE.Vector3(x, y, z).setLength(s.r).add(new THREE.Vector3(...s.c)),
    ),
  )

const touchAt = (p: THREE.Vector3): BathTouch => ({
  bone: new THREE.Object3D(),
  local: p.clone(),
  rest: p.clone(),
  dir: new THREE.Vector3(1, 0, 0),
})

/** Runs the bath `secs` with the finger going once over every point, or not touching. */
function run(b: Bath, coat: Coat, secs: number, points: THREE.Vector3[] = []) {
  const frames = Math.round(secs / DT)
  const touches = points.map(touchAt)
  for (let f = 0; f < frames; f++) {
    const touch = touches[Math.floor((f * touches.length) / frames)] ?? null
    stepBath(b, { coat, touch }, DT)
  }
}

const dirty = (level = 0.4): Care => ({ ...createCare(BREEDS.shiba, 0), cleanliness: 1 - level })
const meanWet = (coat: Coat) => meanDirt(coat.wet)

/** A bath begun on a dirty puppy, with the foam all over it. */
function lathered() {
  const coat = createCoat(rest, dirty()),
    b = createBath()
  beginBath(b)
  run(b, coat, 5, allOver())
  return { b, coat }
}

describe('bath', () => {
  it('rubbing a dirty puppy all over for 5 s leaves its mean dirt below 0.15, with foam', () => {
    const coat = createCoat(rest, dirty())
    expect(meanDirt(coat.dirt.field)).toBeCloseTo(0.4, 2)
    const b = createBath()
    beginBath(b)
    expect(b.phase).toBe('scrub')
    run(b, coat, 5, allOver())
    expect(meanDirt(coat.dirt.field)).toBeLessThan(0.15)
    expect(b.foamN).toBeGreaterThan(50)
    expect(b.foamN).toBeLessThanOrEqual(FOAM_MAX)
  })

  it('scrubs and lathers only where the finger is', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    const before = Float32Array.from(coat.dirt.field)
    run(b, coat, 1, allOver())
    expect(coat.dirt.field).toEqual(before)
    expect(b.foamN).toBe(0)
    beginBath(b)
    const paw = new THREE.Vector3(...A.bones[A.bi.wrL!]!.pos)
    paw.y = 0.04
    run(b, coat, 1, [paw])
    const p = rest.position
    for (let i = 0; i < before.length; i++) {
      const d = Math.hypot(p[i * 3]! - paw.x, p[i * 3 + 1]! - paw.y, p[i * 3 + 2]! - paw.z)
      if (d > 0.2) expect(coat.dirt.field[i]).toBe(before[i])
    }
    expect(meanDirt(coat.dirt.field)).toBeLessThan(meanDirt(before))
    for (let i = 0; i < b.foamN; i++) expect(b.foam[i]!.local.distanceTo(paw)).toBeLessThan(0.06)
  })

  it('«Aclarar» takes the foam away in 1.5 s and leaves it soaked', () => {
    const { b, coat } = lathered()
    expect(rinse(b)).toBe(true)
    expect(b.phase).toBe('rinse')
    run(b, coat, RINSE_TIME / 2)
    expect(b.foamN).toBeGreaterThan(0)
    run(b, coat, RINSE_TIME / 2 + DT)
    expect(b.foamN).toBe(0)
    expect(meanWet(coat)).toBe(1)
    expect(withCoat(dirty(), coat).wet).toBe(1)
    expect(b.phase).toBe('shake')
  })

  it('shakes for 1.2 s, then waits for the dryer', () => {
    const { b, coat } = lathered()
    rinse(b)
    run(b, coat, RINSE_TIME + DT)
    run(b, coat, SHAKE_TIME - 0.1)
    expect(b.phase).toBe('shake')
    run(b, coat, 0.2)
    expect(b.phase).toBe('drying')
    expect(b.dryer).toBe(false)
  })

  it('after the shake, 6 s with the dryer all over leaves it below 0.1 wet', () => {
    const { b, coat } = lathered()
    rinse(b)
    run(b, coat, RINSE_TIME + SHAKE_TIME + 0.1)
    // Without the dryer the finger dries nothing
    run(b, coat, 1, allOver())
    expect(meanWet(coat)).toBeGreaterThan(0.99)
    expect(takeDryer(b)).toBe(true)
    run(b, coat, 6, allOver())
    expect(meanWet(coat)).toBeLessThan(0.1)
  })

  it('without the dryer it dries by itself in 10 min', () => {
    const { b, coat } = lathered()
    rinse(b)
    run(b, coat, RINSE_TIME + DT)
    endBath(b)
    run(b, coat, 300)
    expect(meanWet(coat)).toBeCloseTo(0.5, 1)
    run(b, coat, 300)
    expect(meanWet(coat)).toBe(0)
  })

  it('«Secador» only once rinsed, and finishing clears the foam', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    expect(rinse(b)).toBe(false)
    beginBath(b)
    expect(takeDryer(b)).toBe(false)
    run(b, coat, 0.5, allOver())
    expect(b.foamN).toBeGreaterThan(0)
    endBath(b)
    expect([b.phase, b.foamN]).toEqual(['off', 0])
  })

  it('saved mid-scrub and opened again: no foam, the dirt as scrubbed, the wet as it was', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    beginBath(b)
    run(b, coat, 2, allOver().slice(0, 60))
    const saved: Care = JSON.parse(JSON.stringify(withCoat(dirty(), coat)))
    expect(saved.cleanliness).toBeCloseTo(1 - meanDirt(coat.dirt.field), 6)
    expect(saved.cleanliness).toBeGreaterThan(0.6 + 0.01)
    expect(saved.wet).toBeGreaterThan(0.05)
    expect(saved.wet).toBeLessThan(1)

    const again = createCoat(rest, saved),
      fresh = createBath()
    expect([fresh.phase, fresh.foamN]).toEqual(['off', 0])
    expect(meanDirt(again.dirt.field)).toBeCloseTo(1 - saved.cleanliness, 3)
    expect(meanWet(again)).toBeCloseTo(saved.wet, 6)
  })

  it('saved after the rinse it is soaked; saved while drying, as dry as it got', () => {
    const { b, coat } = lathered()
    rinse(b)
    run(b, coat, RINSE_TIME + DT)
    expect(createCoat(rest, withCoat(dirty(), coat)).wet.every((w) => w === 1)).toBe(true)
    run(b, coat, SHAKE_TIME + 0.1)
    takeDryer(b)
    run(b, coat, 2, allOver())
    const wet = withCoat(dirty(), coat).wet
    expect(wet).toBeGreaterThan(0.1)
    expect(wet).toBeLessThan(0.9)
    expect(meanWet(createCoat(rest, withCoat(dirty(), coat)))).toBeCloseTo(wet, 6)
  })

  it('packs dirt and wet into one attribute, uploaded at most 10 times a second', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    beginBath(b)
    let uploads = 0
    const points = allOver().map(touchAt)
    for (let f = 0; f < 120; f++) {
      stepBath(b, { coat, touch: points[f % points.length]! }, DT)
      if (flushCoat(coat, DT)) uploads++
    }
    expect(uploads).toBeGreaterThan(10)
    expect(uploads).toBeLessThanOrEqual(20)
    expect(flushCoat(coat, DT)).toBe(false)
    expect(flushCoat(coat, 1)).toBe(true)
    for (let i = 0; i < coat.wet.length; i++) {
      expect(coat.packed[i * 2]).toBe(coat.dirt.field[i])
      expect(coat.packed[i * 2 + 1]).toBe(coat.wet[i])
    }
    // Nothing changed: no upload
    expect(flushCoat(coat, 1)).toBe(false)
  })
})

describe('createBathLayer', () => {
  it('draws the foam and the drops from fixed pools, and frees them with the stage', () => {
    const scene = new THREE.Scene()
    const layer = createBathLayer(scene)
    expect(layer.foam.instanceMatrix.count).toBe(FOAM_MAX)
    expect(layer.drops.instanceMatrix.count).toBe(DROP_MAX)

    const coat = createCoat(rest, dirty()),
      b = createBath()
    const group = new THREE.Group()
    const zones = bathSpheres(A).map((s) => ({
      bone: group,
      off: new THREE.Vector3(...s.c),
      r: s.r,
    }))
    const shown = { bath: b, bathZones: zones, bathTouch: null, group }
    const cam = new THREE.Vector3(0, 1, 3)
    const matrices = layer.foam.instanceMatrix.array
    beginBath(b)
    run(b, coat, 1, allOver())
    layer.sync([shown], DT, cam)
    expect(layer.foam.count).toBe(b.foamN)
    rinse(b)
    for (let f = 0; f < 200; f++) {
      stepBath(b, { coat, touch: null }, DT)
      layer.sync([shown], DT, cam)
      expect(layer.drops.count).toBeLessThanOrEqual(DROP_MAX)
    }
    expect(b.phase).not.toBe('rinse')
    expect(layer.drops.count).toBeGreaterThan(0)
    expect(layer.foam.instanceMatrix.array).toBe(matrices)

    const freed: string[] = []
    layer.foam.geometry.addEventListener('dispose', () => freed.push('foam'))
    layer.drops.geometry.addEventListener('dispose', () => freed.push('drops'))
    layer.dispose()
    expect(freed).toEqual(['foam', 'drops'])
    expect(scene.children).toEqual([])
  })
})
