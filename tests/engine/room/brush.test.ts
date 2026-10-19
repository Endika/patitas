// @vitest-environment node
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { createCare, type Care } from '@/domain/care'
import type { Anatomy } from '@/engine/puppy/anatomy'
import { dirtRest, meanDirt, type DirtRest } from '@/engine/puppy/dirt'
import { buildPuppyGeometry } from '@/engine/puppy/geometry'
import { createMotionState } from '@/engine/motion/locomotion'
import { rubCoat, type BathZone } from '@/engine/puppy/view'
import { createCamera } from '@/engine/room/camera'
import {
  bathReach,
  beginBath,
  createBath,
  createCoat,
  stepBath,
  type BathReach,
  type Coat,
  type CoatTouch,
} from '@/engine/room/bath'
import {
  beginBrush,
  createBrush,
  createBrushLayer,
  endBrush,
  grainOf,
  HEART_MAX,
  stepBrush,
  type Brush,
} from '@/engine/room/brush'

const DT = 1 / 60

/** A repeatable stream of draws, so the hearts land the same every run. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}
/** A brisk stroke: a unit of coat a second. */
const SPEED = 1
const HEAD_TO_TAIL = new THREE.Vector3(0, 0, -1)
const GRAIN = grainOf(BREEDS.shiba.fur)

let A: Anatomy, rest: DirtRest, reach: BathReach
beforeAll(() => {
  const built = buildPuppyGeometry(BREEDS.shiba)
  const g = built.geometry
  A = built.anatomy
  rest = dirtRest(g.attributes.position!.array, g.attributes.normal!.array, A.nose.c)
  reach = bathReach(A)
}, 60_000)

const fresh = (care: Partial<Care> = {}): Care => ({ ...createCare(BREEDS.shiba, 0), ...care })

/** The finger on the coat at `at` (rest pose), moving along `dir`. */
const finger = (at: THREE.Vector3, dir: THREE.Vector3): CoatTouch => ({
  bone: new THREE.Object3D(),
  local: at.clone(),
  rest: at.clone(),
  dir: dir.clone().normalize(),
  travel: 0,
})

const backPoint = () => new THREE.Vector3(...A.zones.find((z) => z.zone === 'back')!.c)

interface Stroked {
  care: Care
  hearts: number
}

/** `units` of finger travel along `dir` over `at`, at SPEED, then the brush settles a moment. */
function brush(
  b: Brush,
  coat: Coat,
  care: Care,
  dir: THREE.Vector3,
  units: number,
  { at = backPoint(), cuddly = 0.5 } = {},
): Stroked {
  const touch = finger(at, dir)
  let hearts = 0
  const frames = Math.round(units / (SPEED * DT))
  for (let f = 0; f < frames + 30; f++) {
    touch.travel = f < frames ? SPEED * DT : 0
    care = stepBrush(b, { coat, touch, reach, grain: GRAIN, care, cuddly }, DT)
    hearts += b.hearts
    b.hearts = 0
  }
  return { care, hearts }
}

function brushing(care = fresh()) {
  const b = createBrush(),
    coat = createCoat(rest, care)
  beginBrush(b)
  return { b, coat }
}

describe('stepBrush', () => {
  it('head to tail raises the shine and happiness, and earns hearts', () => {
    const { b, coat } = brushing()
    const { care, hearts } = brush(b, coat, fresh(), HEAD_TO_TAIL, 2)
    expect(care.shine).toBeGreaterThan(0.3)
    expect(care.happiness).toBeGreaterThan(fresh().happiness + 0.03)
    expect(hearts).toBeGreaterThanOrEqual(4)
  })

  it('against the grain it barely counts', () => {
    const along = brushing(),
      against = brushing()
    const good = brush(along.b, along.coat, fresh(), HEAD_TO_TAIL, 2)
    const bad = brush(against.b, against.coat, fresh(), HEAD_TO_TAIL.clone().negate(), 2)
    expect(bad.care.shine).toBeLessThan(good.care.shine * 0.2)
    expect(bad.care.happiness - 0.5).toBeLessThan((good.care.happiness - 0.5) * 0.2)
    expect(bad.hearts).toBe(0)
  })

  it('does as much as the finger travels; a still finger does nothing', () => {
    const one = brushing(),
      two = brushing(),
      none = brushing()
    const a = brush(one.b, one.coat, fresh(), HEAD_TO_TAIL, 1).care.shine
    const b = brush(two.b, two.coat, fresh(), HEAD_TO_TAIL, 2).care.shine
    expect(b / a).toBeGreaterThan(1.9)
    expect(b / a).toBeLessThan(2.1)
    expect(brush(none.b, none.coat, fresh(), HEAD_TO_TAIL, 0)).toEqual({ care: fresh(), hearts: 0 })
  })

  it('a cuddlier puppy enjoys it more; the coat shines the same', () => {
    const shy = brushing(),
      fond = brushing()
    const s = brush(shy.b, shy.coat, fresh(), HEAD_TO_TAIL, 2, { cuddly: 0.1 }).care
    const f = brush(fond.b, fond.coat, fresh(), HEAD_TO_TAIL, 2, { cuddly: 0.9 }).care
    expect(f.happiness).toBeGreaterThan(s.happiness + 0.02)
    expect(s.happiness).toBeGreaterThan(0.5)
    expect(f.shine).toBeCloseTo(s.shine, 6)
  })

  it('feels it while the strokes go with the grain, on the side the finger is', () => {
    const { b, coat } = brushing()
    const at = backPoint().setX(0.05)
    const touch = finger(at, HEAD_TO_TAIL)
    touch.travel = SPEED * DT
    stepBrush(b, { coat, touch, reach, grain: GRAIN, care: fresh(), cuddly: 0.5 }, DT)
    expect([b.touched, b.side]).toEqual([true, 1])
    for (let f = 0; f < 60; f++)
      stepBrush(b, { coat, touch, reach, grain: GRAIN, care: fresh(), cuddly: 0.5 }, DT)
    expect(b.touched).toBe(false)
    touch.dir.negate()
    touch.travel = SPEED * DT
    stepBrush(b, { coat, touch, reach, grain: GRAIN, care: fresh(), cuddly: 0.5 }, DT)
    expect(b.touched).toBe(false)
  })

  it('knocks a little dry dirt off, far less than a scrub; none off a wet coat', () => {
    const paw = new THREE.Vector3(...A.bones[A.bi.wrL!]!.pos).setY(0.05)
    const down = new THREE.Vector3(0, -1, 0)
    const dirty = fresh({ cleanliness: 0.5 })
    const dry = brushing(dirty)
    const before = meanDirt(dry.coat.dirt.field)
    brush(dry.b, dry.coat, dirty, down, 0.2, { at: paw })
    const brushed = before - meanDirt(dry.coat.dirt.field)
    expect(brushed).toBeGreaterThan(0)

    const coat = createCoat(rest, dirty),
      bath = createBath(),
      touch = finger(paw, down)
    beginBath(bath)
    for (let f = 0; f < Math.round(0.2 / (SPEED * DT)); f++) {
      touch.travel = SPEED * DT
      stepBath(bath, { coat, touch, reach }, DT)
    }
    expect(brushed).toBeLessThan((before - meanDirt(coat.dirt.field)) * 0.5)

    const wet = brushing({ ...dirty, wet: 1 })
    const was = meanDirt(wet.coat.dirt.field)
    brush(wet.b, wet.coat, { ...dirty, wet: 1 }, down, 0.2, { at: paw })
    expect(meanDirt(wet.coat.dirt.field)).toBe(was)
  })

  it('put away, the finger does nothing, and the shine wears off in about a day', () => {
    const { b, coat } = brushing()
    endBrush(b)
    expect(brush(b, coat, fresh(), HEAD_TO_TAIL, 2)).toEqual({ care: fresh(), hearts: 0 })
    let care = fresh({ shine: 1 })
    for (let s = 0; s < 6 * 3600; s++)
      care = stepBrush(b, { coat, touch: null, grain: GRAIN, care, cuddly: 0.5 }, 1)
    expect(care.shine).toBeCloseTo(0.75, 2)
  })

  it('leaves a dull, unbrushed coat the same care, so nothing is made each frame', () => {
    const b = createBrush(),
      care = fresh(),
      coat = createCoat(rest, care)
    for (let f = 0; f < 1200; f++)
      expect(stepBrush(b, { coat, touch: null, grain: GRAIN, care, cuddly: 0.5 }, DT)).toBe(care)
  })
})

describe('brushing through the finger, whichever way the puppy stands', () => {
  const az = createCamera().az
  const HEADINGS = {
    facing: az,
    'side-on to the left': az - Math.PI / 2,
    'side-on to the right': az + Math.PI / 2,
    'three-quarter': az + Math.PI / 4,
  }

  /** Shine after the finger slides `units` over its back along world `way`, as the room tracks it. */
  const slide = (heading: number, way: (forward: THREE.Vector3) => THREE.Vector3, units = 0.5) => {
    const group = new THREE.Group()
    group.rotation.y = heading
    const bone = new THREE.Bone()
    bone.position.set(0, 0.4, 0)
    group.add(bone)
    group.updateMatrixWorld(true)
    const zone: BathZone = {
      zone: 'back',
      bone,
      off: new THREE.Vector3(),
      r: 0.1,
      rest: new THREE.Vector3(0, 0.4, 0),
    }
    const motion = createMotionState()
    motion.heading = heading
    const view = { bath: createBath(), coatTouch: null as CoatTouch | null, motion }
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
    const step = way(forward).normalize().multiplyScalar(0.02)
    const p = bone.localToWorld(new THREE.Vector3(0, 0.05, 0))
    const b = createBrush(),
      coat = createCoat(rest, fresh())
    beginBrush(b)
    let care = fresh()
    for (let f = 0; f < units / 0.02; f++) {
      rubCoat(view, zone, p.add(step))
      care = stepBrush(
        b,
        { coat, touch: view.coatTouch, reach, grain: GRAIN, care, cuddly: 0.5 },
        DT,
      )
    }
    for (let f = 0; f < 10; f++)
      care = stepBrush(b, { coat, touch: null, reach, grain: GRAIN, care, cuddly: 0.5 }, DT)
    return care.shine
  }
  const full = () => slide(az, (fw) => fw.negate())

  it.each(Object.entries(HEADINGS))(
    '%s: head to tail counts fully, tail to head barely',
    (_, h) => {
      const along = full()
      expect(along).toBeGreaterThan(0.1)
      expect(slide(h, (fw) => fw.negate())).toBeCloseTo(along, 3)
      expect(slide(h, (fw) => fw)).toBeLessThan(along * 0.15)
    },
  )

  it('facing the camera, down its front counts fully too', () => {
    expect(slide(az, () => new THREE.Vector3(0, -1, 0))).toBeGreaterThan(full() * 0.95)
  })
})

describe('createBrushLayer', () => {
  const setup = () => {
    const scene = new THREE.Scene()
    const layer = createBrushLayer(scene, seeded(7))
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 1, 3)
    camera.lookAt(0, 0.3, 0)
    camera.updateMatrixWorld()
    const b = createBrush()
    const shown = { brush: b, coatTouch: null as CoatTouch | null }
    return { scene, layer, camera, b, shown }
  }

  it('floats the hearts from a fixed pool, and frees everything with the stage', () => {
    const { scene, layer, camera, b, shown } = setup()
    expect(layer.hearts.instanceMatrix.count).toBe(HEART_MAX)
    const matrices = layer.hearts.instanceMatrix.array
    beginBrush(b)
    shown.coatTouch = finger(new THREE.Vector3(0, 0.4, 0), HEAD_TO_TAIL)
    b.heartBone = shown.coatTouch.bone
    b.heartAt.copy(shown.coatTouch.local)
    for (let f = 0; f < 120; f++) {
      b.hearts = 3
      layer.sync([shown], DT, camera)
      expect(b.hearts).toBe(0)
      expect(layer.hearts.count).toBeLessThanOrEqual(HEART_MAX)
    }
    expect(layer.hearts.count).toBeGreaterThan(0)
    expect(layer.hearts.visible).toBe(true)
    expect(layer.hearts.instanceMatrix.array).toBe(matrices)
    const m = new THREE.Matrix4(),
      p = new THREE.Vector3()
    layer.hearts.getMatrixAt(0, m)
    expect(p.setFromMatrixPosition(m).y).toBeGreaterThan(0.4)

    const freed: string[] = []
    layer.hearts.geometry.addEventListener('dispose', () => freed.push('hearts'))
    layer.dispose()
    expect(freed).toEqual(['hearts'])
    expect(scene.children).toEqual([])
  })

  it('with nothing to show it neither uploads nor draws', () => {
    const { layer, camera, shown } = setup()
    const was = layer.hearts.instanceMatrix.version
    for (let f = 0; f < 10; f++) layer.sync([shown], DT, camera)
    expect(layer.hearts.instanceMatrix.version).toBe(was)
    expect(layer.hearts.visible).toBe(false)
  })

  it('shows the hearts of the last stroke even once the finger has lifted', () => {
    const { layer, camera, b, shown } = setup()
    const coat = createCoat(rest, fresh())
    const touch = finger(backPoint(), HEAD_TO_TAIL)
    beginBrush(b)
    for (let f = 0; f < 30 && !b.hearts; f++) {
      touch.travel = 0.1
      stepBrush(b, { coat, touch, reach, grain: GRAIN, care: fresh(), cuddly: 0.5 }, DT)
    }
    expect(b.hearts).toBeGreaterThan(0)
    shown.coatTouch = null
    layer.sync([shown], DT, camera)
    expect(layer.hearts.count).toBeGreaterThan(0)
  })

  it('shows the brush in hand only while the finger is on the puppy being brushed', () => {
    const { layer, camera, b, shown } = setup()
    const at = new THREE.Vector3(0.1, 0.4, 0)
    shown.coatTouch = finger(at, HEAD_TO_TAIL)
    layer.sync([shown], DT, camera)
    expect(layer.tool.visible).toBe(false)
    beginBrush(b)
    layer.sync([shown], DT, camera)
    expect(layer.tool.visible).toBe(true)
    expect(layer.tool.position.distanceTo(at)).toBeLessThan(0.3)
    shown.coatTouch = null
    layer.sync([shown], DT, camera)
    expect(layer.tool.visible).toBe(false)
  })
})
