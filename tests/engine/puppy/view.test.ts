// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { createCare } from '@/domain/care'
import { createMotionState } from '@/engine/motion/locomotion'
import { setPose } from '@/engine/motion/poses'
import { createFetchState } from '@/engine/motion/fetch'
import { createRoutineState, tuckIn } from '@/engine/motion/routine'
import { createBehaviourState } from '@/engine/puppy/behaviour'
import {
  disposeOwn,
  hitZone,
  offerBall,
  ownGeometry,
  restBounds,
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
  it('shares the breed mesh and frees only its own dirt when a view goes', () => {
    const shared = new THREE.BoxGeometry(0.4, 0.6, 0.8)
    const names = Object.keys(shared.attributes)
    const dirtA = new THREE.BufferAttribute(new Float32Array(shared.attributes.position!.count), 1)
    const dirtB = new THREE.BufferAttribute(new Float32Array(shared.attributes.position!.count), 1)
    const a = ownGeometry(shared, dirtA),
      b = ownGeometry(shared, dirtB)
    for (const n of names) {
      expect(a.attributes[n]).toBe(shared.attributes[n])
      expect(b.attributes[n]).toBe(shared.attributes[n])
    }
    expect(a.index).toBe(shared.index)
    expect(a.attributes.dirt).toBe(dirtA)

    // What the renderer would free is what the geometry still lists when it is disposed
    let freed: { attrs: THREE.BufferAttribute[]; index: unknown } | null = null
    a.addEventListener('dispose', () => {
      freed = {
        attrs: Object.values(a.attributes) as THREE.BufferAttribute[],
        index: a.index,
      }
    })
    disposeOwn(a, shared)
    expect(freed).toEqual({ attrs: [dirtA], index: null })
    expect(Object.keys(shared.attributes)).toEqual(names)
    for (const n of names) expect(b.attributes[n]).toBe(shared.attributes[n])
    expect(b.index).toBe(shared.index)
    expect(b.attributes.dirt).toBe(dirtB)
  })
})
