// @vitest-environment node
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { BREEDS, type BreedId } from '@/domain/breeds'
import { createCare, type Care } from '@/domain/care'
import type { Anatomy } from '@/engine/puppy/anatomy'
import { dirtRest, meanDirt, type DirtRest } from '@/engine/puppy/dirt'
import { buildPuppyGeometry } from '@/engine/puppy/geometry'
import {
  bathReach,
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
  type BathReach,
  type CoatTouch,
  type Coat,
} from '@/engine/room/bath'
import { createCamera } from '@/engine/room/camera'
import { raySphere } from '@/engine/room/input'

const DT = 1 / 60

interface Pup {
  A: Anatomy
  rest: DirtRest
  reach: BathReach
}
const pups = {} as Record<'shiba' | 'dorado', Pup>
let A: Anatomy, rest: DirtRest, reach: BathReach

beforeAll(() => {
  for (const id of ['shiba', 'dorado'] as const satisfies BreedId[]) {
    const built = buildPuppyGeometry(BREEDS[id])
    const g = built.geometry
    pups[id] = {
      A: built.anatomy,
      rest: dirtRest(
        g.attributes.position!.array,
        g.attributes.normal!.array,
        built.anatomy.nose.c,
      ),
      reach: bathReach(built.anatomy),
    }
  }
  ;({ A, rest, reach } = pups.shiba)
}, 60_000)

/** The room camera's view direction, and a phone's 360 × 640 framing of it. */
const CAM = createCamera()
const LOOK = new THREE.Vector3(
  -Math.sin(CAM.az) * Math.cos(CAM.el),
  -Math.sin(CAM.el),
  -Math.cos(CAM.az) * Math.cos(CAM.el),
)
const PX_PER_UNIT = 212
/** A player's strokes: rows 30 px apart at 400 px/s. */
const ROW = 30 / PX_PER_UNIT,
  SPEED = 400 / PX_PER_UNIT
const Y = new THREE.Vector3(0, 1, 0)
const HEADINGS = {
  facing: CAM.az,
  'three-quarter': CAM.az + Math.PI / 4,
  'side-on': CAM.az + Math.PI / 2,
}

/**
 * A finger zigzagging over the puppy as the room camera sees it, turned `heading` and standing
 * still in its rest pose: each frame it touches the first bath sphere under it, as `hitCoat` does,
 * and how far the touch moved is the travel `rubCoat` would measure.
 */
function stroker(pup: Pup, heading: number) {
  const d = LOOK.clone().applyAxisAngle(Y, -heading)
  const right = d.clone().cross(Y).normalize(),
    up = right.clone().cross(d).normalize()
  const spheres = bathSpheres(pup.A).map((s) => ({ c: new THREE.Vector3(...s.c), r: s.r }))
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity
  for (const { c, r } of spheres) {
    u0 = Math.min(u0, c.dot(right) - r)
    u1 = Math.max(u1, c.dot(right) + r)
    v0 = Math.min(v0, c.dot(up) - r)
    v1 = Math.max(v1, c.dot(up) + r)
  }
  const path: [number, number][] = []
  for (let v = v1 - ROW / 2, k = 0; v > v0; v -= ROW, k++)
    path.push(
      ...((k % 2
        ? [
            [u1, v],
            [u0, v],
          ]
        : [
            [u0, v],
            [u1, v],
          ]) as [number, number][]),
    )
  const legs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]))
  const length = legs.reduce((a, b) => a + b, 0)
  const ray = new THREE.Ray(new THREE.Vector3(), d)
  const touch: CoatTouch = {
    bone: new THREE.Object3D(),
    local: new THREE.Vector3(),
    rest: new THREE.Vector3(),
    dir: new THREE.Vector3(1, 0, 0),
    travel: 0,
  }
  let s = 0,
    was: THREE.Vector3 | null = null
  /** Where the finger is after another frame, or null when it is off the puppy. */
  return (): CoatTouch | null => {
    s += SPEED * DT
    if (s >= length) {
      s -= length
      was = null
    }
    let at = s,
      i = 0
    while (at > legs[i]!) at -= legs[i++]!
    const a = path[i]!,
      b = path[i + 1]!,
      k = at / legs[i]!
    ray.origin
      .copy(right)
      .multiplyScalar(a[0] + (b[0] - a[0]) * k)
      .addScaledVector(up, a[1] + (b[1] - a[1]) * k)
      .addScaledVector(d, -5)
    let best = Infinity
    for (const { c, r } of spheres) {
      const t = raySphere(ray, c, r)
      if (t > 0 && t < best) best = t
    }
    if (best === Infinity) {
      was = null
      return null
    }
    const p = ray.at(best, new THREE.Vector3())
    touch.travel = was ? p.distanceTo(was) : 0
    touch.local.copy(p)
    touch.rest.copy(p)
    was = p
    return touch
  }
}

/** Strokes the puppy for `secs` from the side `heading` shows, or runs the bath untouched. */
function run(b: Bath, coat: Coat, secs: number, heading?: number, pup = pups.shiba) {
  const next = heading == null ? () => null : stroker(pup, heading)
  for (let f = 0; f < Math.round(secs / DT); f++)
    stepBath(b, { coat, touch: next(), reach: pup.reach }, DT)
}

/** A finger on `p` that does not move. */
const still = (p: THREE.Vector3): CoatTouch => ({
  bone: new THREE.Object3D(),
  local: p.clone(),
  rest: p.clone(),
  dir: new THREE.Vector3(1, 0, 0),
  travel: 0,
})

const QUARTER = HEADINGS['three-quarter']
const dirty = (level = 0.4): Care => ({ ...createCare(BREEDS.shiba, 0), cleanliness: 1 - level })
const meanWet = (coat: Coat) => meanDirt(coat.wet)

/** A bath begun on a dirty puppy, lathered for a few seconds. */
function lathered() {
  const coat = createCoat(rest, dirty()),
    b = createBath()
  beginBath(b)
  run(b, coat, 3, QUARTER)
  return { b, coat }
}

/** Rest positions within `r` of `p`. */
const near = (r: number, p: THREE.Vector3) => {
  const out: number[] = [],
    q = rest.position
  for (let i = 0; i < q.length / 3; i++)
    if (Math.hypot(q[i * 3]! - p.x, q[i * 3 + 1]! - p.y, q[i * 3 + 2]! - p.z) < r) out.push(i)
  return out
}
const meanAt = (field: Float32Array, idx: number[]) =>
  idx.reduce((a, i) => a + field[i]!, 0) / idx.length

describe.each(['shiba', 'dorado'] as const)('a player bathing the %s', (id) => {
  it.each(Object.entries(HEADINGS))(
    'seen %s, gets it clean in 10 s and dry in 15 s',
    (_, heading) => {
      const pup = pups[id]
      const coat = createCoat(pup.rest, dirty()),
        b = createBath()
      expect(meanDirt(coat.dirt.field)).toBeCloseTo(0.4, 2)
      beginBath(b)
      run(b, coat, 10, heading, pup)
      expect(meanDirt(coat.dirt.field)).toBeLessThan(0.15)
      expect(b.foamN).toBeGreaterThan(30)
      rinse(b)
      run(b, coat, RINSE_TIME + SHAKE_TIME + 0.1)
      takeDryer(b)
      run(b, coat, 15, heading, pup)
      expect(meanWet(coat)).toBeLessThan(0.1)
    },
  )
})

describe('bath', () => {
  it('a still finger neither scrubs nor dries nor lathers', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    beginBath(b)
    const paw = new THREE.Vector3(...A.bones[A.bi.wrL!]!.pos)
    paw.y = 0.04
    const before = Float32Array.from(coat.dirt.field)
    for (let f = 0; f < 120; f++) stepBath(b, { coat, touch: still(paw), reach }, DT)
    expect(coat.dirt.field).toEqual(before)
    expect(b.foamN).toBe(0)
    expect(b.touched).toBe(false)
    rinse(b)
    run(b, coat, RINSE_TIME + SHAKE_TIME + 0.1)
    takeDryer(b)
    for (let f = 0; f < 120; f++) stepBath(b, { coat, touch: still(paw), reach }, DT)
    expect(meanWet(coat)).toBeGreaterThan(0.99)
  })

  it('scrubs where the finger rubs a paw, and the other three paws, and nothing else', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    const before = Float32Array.from(coat.dirt.field)
    run(b, coat, 1, QUARTER)
    expect(coat.dirt.field).toEqual(before)
    expect(b.foamN).toBe(0)
    beginBath(b)
    const paw = new THREE.Vector3(...A.bones[A.bi.wrL!]!.pos)
    paw.y = 0.04
    const swap = reach.legSwap - paw.z
    const paws = [
      paw,
      paw.clone().setX(-paw.x),
      paw.clone().setZ(swap),
      paw.clone().setX(-paw.x).setZ(swap),
    ]
    const touch = still(paw)
    for (let f = 0; f < 60; f++) {
      touch.rest.x = touch.local.x = paw.x + 0.02 * Math.sin(f / 3)
      touch.travel = 0.02
      stepBath(b, { coat, touch, reach }, DT)
    }
    const p = rest.position
    for (let i = 0; i < before.length; i++) {
      const at = new THREE.Vector3(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!)
      if (paws.every((q) => at.distanceTo(q) > 0.2)) expect(coat.dirt.field[i]).toBe(before[i])
    }
    for (const side of paws) {
      const idx = near(0.08, side)
      expect(meanAt(coat.dirt.field, idx)).toBeLessThan(meanAt(before, idx) * 0.5)
    }
    expect(b.foamN).toBeGreaterThan(0)
    for (let i = 0; i < b.foamN; i++) expect(b.foam[i]!.local.distanceTo(paw)).toBeLessThan(0.06)
  })

  it('a stroke low on the flank reaches the belly underneath', () => {
    const coat = createCoat(rest, dirty(0.6)),
      b = createBath()
    beginBath(b)
    const flank = new THREE.Vector3(0.13, reach.bellyY + 0.08, 0)
    const belly = near(0.06, new THREE.Vector3(0, reach.bellyY, 0))
    expect(belly.length).toBeGreaterThan(10)
    const before = meanAt(coat.dirt.field, belly)
    expect(before).toBeGreaterThan(0.3)
    const touch = still(flank)
    for (let f = 0; f < 60; f++) {
      touch.rest.z = touch.local.z = 0.03 * Math.sin(f / 3)
      touch.travel = 0.02
      stepBath(b, { coat, touch, reach }, DT)
    }
    expect(meanAt(coat.dirt.field, belly)).toBeLessThan(before * 0.5)
  })

  it('«Aclarar» takes the foam away in 1.5 s and leaves it soaked', () => {
    const { b, coat } = lathered()
    expect(b.foamN).toBeGreaterThan(0)
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

  it('shakes for 1.2 s, then waits for the dryer; without it the finger dries nothing', () => {
    const { b, coat } = lathered()
    rinse(b)
    run(b, coat, RINSE_TIME + DT)
    run(b, coat, SHAKE_TIME - 0.1)
    expect(b.phase).toBe('shake')
    run(b, coat, 0.2)
    expect(b.phase).toBe('drying')
    expect(b.dryer).toBe(false)
    run(b, coat, 1, QUARTER)
    expect(meanWet(coat)).toBeGreaterThan(0.99)
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
    run(b, coat, 0.5, QUARTER)
    expect(b.foamN).toBeGreaterThan(0)
    endBath(b)
    expect([b.phase, b.foamN]).toEqual(['off', 0])
  })

  it('saved mid-scrub and opened again: no foam, the dirt as scrubbed, the wet as it was', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    beginBath(b)
    run(b, coat, 2, QUARTER)
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
    run(b, coat, 2, QUARTER)
    const wet = withCoat(dirty(), coat).wet
    expect(wet).toBeGreaterThan(0.1)
    expect(wet).toBeLessThan(0.95)
    expect(meanWet(createCoat(rest, withCoat(dirty(), coat)))).toBeCloseTo(wet, 6)
  })

  it('packs dirt and wet into one attribute, uploaded at most 10 times a second', () => {
    const coat = createCoat(rest, dirty()),
      b = createBath()
    beginBath(b)
    let uploads = 0
    const next = stroker(pups.shiba, QUARTER)
    for (let f = 0; f < 120; f++) {
      stepBath(b, { coat, touch: next(), reach }, DT)
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
  const setup = () => {
    const scene = new THREE.Scene()
    const layer = createBathLayer(scene)
    const coat = createCoat(rest, dirty()),
      b = createBath()
    const group = new THREE.Group()
    group.position.set(0.3, 0, -0.2)
    group.updateMatrixWorld(true)
    const zones = bathSpheres(A).map((s) => ({
      bone: group,
      off: new THREE.Vector3(...s.c),
      r: s.r,
    }))
    const shown = { bath: b, bathZones: zones, coatTouch: null as CoatTouch | null, group }
    return { scene, layer, coat, b, shown, cam: new THREE.Vector3(0, 1, 3) }
  }

  it('draws the foam and the drops from fixed pools, and frees them with the stage', () => {
    const { scene, layer, coat, b, shown, cam } = setup()
    expect(layer.foam.instanceMatrix.count).toBe(FOAM_MAX)
    expect(layer.drops.instanceMatrix.count).toBe(DROP_MAX)
    const matrices = layer.foam.instanceMatrix.array
    beginBath(b)
    run(b, coat, 1, QUARTER)
    layer.sync([shown], DT, cam)
    expect(layer.foam.count).toBe(b.foamN)
    expect(layer.foam.visible).toBe(true)
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

  it('with nothing to show it neither uploads nor draws', () => {
    const { layer, shown, cam } = setup()
    const versions = () => [layer.foam.instanceMatrix.version, layer.drops.instanceMatrix.version]
    const was = versions()
    for (let f = 0; f < 10; f++) layer.sync([shown], DT, cam)
    expect(versions()).toEqual(was)
    expect([layer.foam.visible, layer.drops.visible]).toEqual([false, false])
  })

  it('keeps the shaken-off drops round the puppy', () => {
    const { layer, coat, b, shown, cam } = setup()
    beginBath(b)
    rinse(b)
    run(b, coat, RINSE_TIME + DT)
    const m = new THREE.Matrix4(),
      p = new THREE.Vector3()
    let seen = 0
    for (let f = 0; f < 120; f++) {
      stepBath(b, { coat, touch: null }, DT)
      layer.sync([shown], DT, cam)
      for (let i = 0; i < layer.drops.count; i++) {
        layer.drops.getMatrixAt(i, m)
        p.setFromMatrixPosition(m)
        expect(Math.hypot(p.x - 0.3, p.z + 0.2)).toBeLessThan(1)
        seen++
      }
    }
    expect(seen).toBeGreaterThan(100)
  })

  it('shows the dryer only while the finger is on the puppy', () => {
    const { layer, coat, b, shown, cam } = setup()
    const dryer = () => layer.foam.parent!.children.find((o) => o instanceof THREE.Group)!
    beginBath(b)
    rinse(b)
    run(b, coat, RINSE_TIME + SHAKE_TIME + 0.1)
    takeDryer(b)
    shown.coatTouch = still(new THREE.Vector3(0.1, 0.4, 0))
    layer.sync([shown], DT, cam)
    expect(dryer().visible).toBe(true)
    shown.coatTouch = null
    layer.sync([shown], DT, cam)
    expect(dryer().visible).toBe(false)
  })
})
