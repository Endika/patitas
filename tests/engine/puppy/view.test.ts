// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { createCare } from '@/domain/care'
import { createMotionState } from '@/engine/motion/locomotion'
import { setPose } from '@/engine/motion/poses'
import { createFetchState } from '@/engine/motion/fetch'
import { createRoutineState, holdStill, tuckIn, weighing } from '@/engine/motion/routine'
import { createBehaviourState } from '@/engine/puppy/behaviour'
import { beginBath, createBath } from '@/engine/room/bath'
import { createBrush } from '@/engine/room/brush'
import { createCamera, fitCamera } from '@/engine/room/camera'
import { computeSpots } from '@/engine/room/furniture'
import { createLegStates } from '@/engine/motion/locomotion'
import { legRigs } from '@/engine/motion/ik'
import { anatomy } from '@/engine/puppy/anatomy'
import {
  brushPuppy,
  cheerUp,
  coatWork,
  disposeOwn,
  hitCoat,
  hitZone,
  liftCoat,
  rubCoat,
  soilingDepth,
  type BathZone,
  type PuppyView,
  offerBall,
  ownGeometry,
  restBounds,
  stopBrushing,
  weighPuppy,
  type ZoneRig,
} from '@/engine/puppy/view'
import { createBall } from '@/engine/room/ball'

describe('hitZone', () => {
  // A ray from the side passes the belly first and the chest behind it
  const body = new THREE.Bone()
  const zones: ZoneRig[] = [
    { zone: 'belly', bone: body, off: new THREE.Vector3(0, 0.2, 0), r: 0.1 },
    { zone: 'chest', bone: body, off: new THREE.Vector3(0.4, 0.2, 0), r: 0.1 },
  ]
  const ray = new THREE.Ray(new THREE.Vector3(-1, 0.2, 0), new THREE.Vector3(1, 0, 0))

  it('never strokes the belly of a standing puppy', () => {
    expect(hitZone({ motion: createMotionState(), zones }, ray)?.zone).toBe('chest')
  })

  it('strokes the belly while it lies down or shows it', () => {
    for (const pose of ['lie', 'belly'] as const) {
      const motion = createMotionState()
      setPose(motion, pose)
      expect(hitZone({ motion, zones }, ray)?.zone).toBe('belly')
    }
  })
})

describe('restBounds', () => {
  it('places the shared geometry box where the puppy stands, measuring the geometry once', () => {
    const geometry = new THREE.BoxGeometry(0.4, 0.6, 0.8).translate(0, 0.3, 0)
    const group = new THREE.Group()
    group.position.set(1, 0, -2)
    group.updateMatrixWorld(true)

    const first = restBounds(geometry, group)
    const cached = geometry.boundingBox
    const second = restBounds(geometry, group)

    expect(cached).not.toBeNull()
    expect(geometry.boundingBox).toBe(cached)
    const close = (v: THREE.Vector3, to: [number, number, number]) =>
      to.forEach((x, i) => expect(v.getComponent(i)).toBeCloseTo(x))
    close(first.min, [0.8, 0, -2.4])
    close(first.max, [1.2, 0.6, -1.6])
    expect(second).not.toBe(first)
    second.expandByScalar(1)
    close(cached!.max, [0.2, 0.6, 0.4])
  })
})

describe('offerBall', () => {
  it('lets a sleeping puppy sleep on while the awake one waits for the throw', () => {
    const pup = () => ({
      motion: createMotionState(),
      fetch: createFetchState(),
      behaviour: createBehaviourState(),
      routine: createRoutineState(),
      care: createCare(BREEDS.shiba, 0),
    })
    const awake = pup(),
      asleep = pup()
    tuckIn(asleep.routine, asleep.motion)
    offerBall([awake, asleep], createBall())
    expect([awake.fetch.task, asleep.fetch.task]).toEqual(['wait', 'free'])
    expect([asleep.routine.routine, asleep.motion.pose]).toEqual(['sleeping', 'sleep'])
  })

  it('lets a very hungry puppy finish its meal, and calls one a little hungry to play', () => {
    const pup = (hunger: number) => {
      const routine = createRoutineState()
      routine.routine = 'eating'
      return {
        motion: createMotionState(),
        fetch: createFetchState(),
        behaviour: createBehaviourState(),
        routine,
        care: { ...createCare(BREEDS.shiba, 0), hunger },
      }
    }
    const hungry = pup(0.8),
      peckish = pup(0.2)
    offerBall([hungry, peckish], createBall())
    expect([hungry.fetch.task, peckish.fetch.task]).toEqual(['free', 'wait'])
  })
})

describe('ownGeometry', () => {
  it('shares the breed mesh and frees only its own coat when a view goes', () => {
    const shared = new THREE.BoxGeometry(0.4, 0.6, 0.8)
    const names = Object.keys(shared.attributes)
    const coat = () =>
      new THREE.BufferAttribute(new Float32Array(shared.attributes.position!.count * 2), 2)
    const coatA = coat(),
      coatB = coat()
    const a = ownGeometry(shared, coatA),
      b = ownGeometry(shared, coatB)
    for (const n of names) {
      expect(a.attributes[n]).toBe(shared.attributes[n])
      expect(b.attributes[n]).toBe(shared.attributes[n])
    }
    expect(a.index).toBe(shared.index)
    expect(a.attributes.coat).toBe(coatA)

    // What the renderer would free is what the geometry still lists when it is disposed
    let freed: { attrs: THREE.BufferAttribute[]; index: unknown } | null = null
    a.addEventListener('dispose', () => {
      freed = {
        attrs: Object.values(a.attributes) as THREE.BufferAttribute[],
        index: a.index,
      }
    })
    disposeOwn(a, shared)
    expect(freed).toEqual({ attrs: [coatA], index: null })
    expect(Object.keys(shared.attributes)).toEqual(names)
    for (const n of names) expect(b.attributes[n]).toBe(shared.attributes[n])
    expect(b.index).toBe(shared.index)
    expect(b.attributes.coat).toBe(coatB)
  })
})

describe('the bath', () => {
  // A standing puppy turned a quarter round, its paw bone 0.1 up and 0.2 in front at rest
  const group = new THREE.Group()
  group.rotation.y = Math.PI / 2
  const paw = new THREE.Bone()
  paw.position.set(0, 0.1, 0.2)
  group.add(paw)
  group.updateMatrixWorld(true)
  const z: BathZone = {
    zone: 'chest',
    bone: paw,
    off: new THREE.Vector3(0, -0.06, 0),
    r: 0.06,
    rest: new THREE.Vector3(0, 0.1, 0.2),
  }

  it('reaches the paws, which petting never does', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0.2, 0.04, 3), new THREE.Vector3(0, 0, -1))
    expect(hitZone({ motion: createMotionState(), zones: [] }, ray)).toBeNull()
    const hit = hitCoat({ bathZones: [z] }, ray)
    expect(hit?.bathZone).toBe(z)
    expect(hit!.point.z).toBeCloseTo(0.06, 2)
  })

  it('knows where the finger is at rest and which way it moves, in the puppy frame', () => {
    const view: Pick<PuppyView, 'bath' | 'coatTouch' | 'motion'> = {
      bath: createBath(),
      coatTouch: null,
      motion: createMotionState(),
    }
    view.motion.heading = Math.PI / 2
    const at = paw.localToWorld(new THREE.Vector3(0.03, -0.05, 0))
    rubCoat(view, z, at)
    const t = view.coatTouch!
    expect(t.bone).toBe(paw)
    expect(t.rest.distanceTo(new THREE.Vector3(0.03, 0.05, 0.2))).toBeLessThan(1e-9)
    // Along the world's −z is the puppy's own +x, a quarter turn round
    rubCoat(view, z, at.clone().add(new THREE.Vector3(0, 0, -0.02)))
    expect(t.dir.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-9)
    // The bath uses up how far it slid; off the puppy and back on, it starts again
    expect(t.travel).toBeCloseTo(0.02, 9)
    liftCoat(view)
    expect(view.coatTouch).toBeNull()
    rubCoat(view, z, at)
    expect(view.coatTouch!.travel).toBe(0)
  })
})

describe('brushing and weighing', () => {
  const pup = () => ({
    motion: createMotionState(),
    fetch: createFetchState(),
    routine: createRoutineState(),
    brush: createBrush(),
    bath: createBath(),
    coatTouch: null,
  })

  it('with the brush in hand the finger works the whole coat, as in the bath', () => {
    const p = pup()
    expect(coatWork(p)).toBe(false)
    expect(brushPuppy(p)).toBe(true)
    expect([coatWork(p), p.routine.routine, p.routine.held]).toEqual([true, 'brushing', 'brushing'])
    stopBrushing(p)
    expect([coatWork(p), p.routine.routine, p.routine.held]).toEqual([false, 'none', null])
    const bathed = pup()
    beginBath(bathed.bath)
    expect(coatWork(bathed)).toBe(true)
  })

  it('a sleeper stretches first; a ball in hand goes back; not mid-game nor in its bath', () => {
    const sleeper = pup()
    tuckIn(sleeper.routine, sleeper.motion)
    expect(brushPuppy(sleeper)).toBe(true)
    expect(sleeper.routine.routine).toBe('stretch')
    const waiting = pup()
    waiting.fetch.task = 'wait'
    expect(weighPuppy(waiting)).toBe(true)
    expect([waiting.fetch.task, weighing(waiting.routine)]).toEqual(['free', true])
    const chasing = pup()
    chasing.fetch.task = 'chase'
    expect([brushPuppy(chasing), weighPuppy(chasing)]).toEqual([false, false])
    const bathed = pup()
    holdStill(bathed.routine, bathed.motion, 'bathing')
    expect([brushPuppy(bathed), weighPuppy(bathed)]).toEqual([false, false])
    expect(bathed.routine.routine).toBe('bathing')
  })
})

describe('soilingDepth', () => {
  it('soils a puppy standing in the puddle, but not one in its bath', () => {
    const spots = computeSpots(fitCamera(createCamera(), 0.46), 1)
    const motion = createMotionState()
    motion.pos.copy(spots.mud.center)
    const legs = createLegStates(legRigs(anatomy(BREEDS.shiba)), motion)
    const routine = createRoutineState()
    expect(soilingDepth({ routine, motion, legs }, spots, [])).toBeGreaterThan(0.5)
    routine.held = 'bathing'
    expect(soilingDepth({ routine, motion, legs }, spots, [])).toBe(0)
  })
})

describe('cheerUp', () => {
  const cheery = () => ({
    behaviour: createBehaviourState(),
    brush: createBrush(),
    care: { ...createCare(BREEDS.shiba, 0), happiness: 0.5 },
    moodWas: 0.25,
    joy: 0,
  })

  it('keeps a share of each rise in mood as happiness, and nothing of a fall', () => {
    const v = cheery()
    v.behaviour.happy = 0.65
    cheerUp(v)
    expect(v.care.happiness).toBeCloseTo(0.6)
    const before = v.care
    v.behaviour.happy = 0.3
    cheerUp(v)
    expect(v.care).toBe(before)
  })

  it('writes small rises once they add up, and leaves brushing to the brush', () => {
    const v = cheery()
    v.behaviour.happy = 0.27
    cheerUp(v)
    expect(v.care.happiness).toBe(0.5)
    v.behaviour.happy = 0.31
    cheerUp(v)
    expect(v.care.happiness).toBeCloseTo(0.515)
    v.brush.on = true
    v.behaviour.happy = 0.9
    cheerUp(v)
    expect(v.care.happiness).toBeCloseTo(0.515)
  })
})
