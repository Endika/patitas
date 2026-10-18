// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS, type Persona } from '@/domain/breeds'
import { createFetchState, type FetchTask } from '@/engine/motion/fetch'
import { createMotionState, type BodyPose } from '@/engine/motion/locomotion'
import type { ZoneId } from '@/engine/puppy/anatomy'
import {
  behaviourRig,
  createBehaviourState,
  movePet,
  startPet,
  stepBehaviour,
  type BehaviourInput,
  type BehaviourState,
} from '@/engine/puppy/behaviour'
import { createBall } from '@/engine/room/ball'

const DT = 1 / 60
const STILL: BodyPose = { y: 0, pitch: 0, roll: 0, k: 0 }

function world(persona: Persona = BREEDS.dorado.defaultPersona, task: FetchTask = 'free') {
  const rig = behaviourRig(BREEDS.dorado, persona, [0, 0.62, 0.43])
  const s = createBehaviourState()
  const fetch = createFetchState()
  fetch.task = task
  const input: BehaviourInput = {
    now: 0,
    petting: false,
    petHeadX: 0,
    motion: createMotionState(),
    body: STILL,
    fetch,
    ball: createBall(),
    camera: new THREE.Vector3(0.9, 0.9, 2.2),
    random: () => 0.5,
  }
  return { rig, s, input }
}

/** Strokes the puppy every frame for `secs`, switching zone every 100 ms through `zones`. */
function caress(zones: ZoneId[], secs: number): BehaviourState {
  const { rig, s, input } = world()
  const point = new THREE.Vector3(0, 0.5, 0)
  startPet(s, zones[0]!, point, 0)
  input.petting = true
  for (let f = 1; f * DT <= secs; f++) {
    input.now = f * DT
    const zone = zones[Math.floor(input.now / 0.1) % zones.length]!
    movePet(s, zone, point, input.now, 4)
    stepBehaviour(rig, s, input, DT, input.now)
  }
  return s
}

describe('stepBehaviour', () => {
  it('starts the hind-leg scratch after a steady caress on the back', () => {
    expect(caress(['back'], 0.9).scratch).toBeGreaterThan(0.5)
  })

  it('treats back and belly as one caress, so alternating them keeps the scratch count', () => {
    expect(caress(['back', 'belly'], 0.9).scratch).toBeGreaterThan(0.5)
  })

  it('restarts the scratch count when the hand moves to another zone', () => {
    expect(caress(['back', 'chest'], 0.9).scratch).toBeLessThan(0.05)
  })

  it('wags faster with more energy', () => {
    const wagAfter = (energy: number) => {
      const { rig, s, input } = world({ energy, cuddly: 0.5, curious: 0.5 })
      for (let f = 1; f <= 60; f++) {
        input.now = f * DT
        stepBehaviour(rig, s, input, DT, input.now)
      }
      return s.wag
    }
    const calm = wagAfter(0),
      lively = wagAfter(1)
    expect(lively).toBeGreaterThan(calm * 1.5)
  })

  it.each([
    [0.05, 1],
    [-0.05, -1],
  ])('keeps the head yaw within ±1.1 rad when the target is behind (x %f)', (x, sign) => {
    const { rig, s, input } = world(undefined, 'wait')
    input.ball.state = 'hand'
    input.ball.pos.set(x, 0.3, -2)
    let most = 0
    for (let f = 1; f <= 180; f++) {
      input.now = f * DT
      stepBehaviour(rig, s, input, DT, input.now)
      most = Math.max(most, Math.abs(s.yaw.x))
    }
    expect(s.yaw.x * sign).toBeCloseTo(1.1, 2)
    expect(most).toBeLessThan(1.1 * 1.02)
  })
})
