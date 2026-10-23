// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { createCare, settle } from '@/domain/care'
import { createMotionState } from '@/engine/motion/locomotion'
import { setPose } from '@/engine/motion/poses'
import { createFetchState } from '@/engine/motion/fetch'
import {
  bedSlots,
  createRoutineState,
  goWeigh,
  holdStill,
  tuckIn,
  weighing,
} from '@/engine/motion/routine'
import {
  behaviourRig,
  createBehaviourState,
  endPet,
  movePet,
  startPet,
  stepBehaviour,
  type BehaviourInput,
} from '@/engine/puppy/behaviour'
import { beginBath, createBath, createCoat } from '@/engine/room/bath'
import { createBrush } from '@/engine/room/brush'
import { createCamera, fitCamera } from '@/engine/room/camera'
import { computeSpots } from '@/engine/room/furniture'
import { createLegStates } from '@/engine/motion/locomotion'
import { dirtRest, meanDirt } from '@/engine/puppy/dirt'
import { legRigs } from '@/engine/motion/ik'
import { anatomy } from '@/engine/puppy/anatomy'
import {
  brushPuppy,
  callOver,
  cheerUp,
  comeHopping,
  hearNoise,
  dropFetch,
  putToBed,
  rebed,
  showCare,
  coatWork,
  disposeOwn,
  hitCoat,
  hitZone,
  mayStepAside,
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

describe('callOver', () => {
  const pup = () => ({
    motion: createMotionState(),
    behaviour: createBehaviourState(),
    routine: createRoutineState(),
    care: createCare(BREEDS.shiba, 0),
  })
  const opts = () => ({
    happy: 0.5,
    energy: 0.5,
    clamp: (x: number, z: number) => [x, z] as [number, number],
  })

  it('sends only the selected puppy of two where the floor was tapped', () => {
    const first = pup(),
      second = pup()
    callOver([first, second], 1, 0.6, -0.4, opts)
    expect(first.motion.goal).toBeNull()
    expect(second.motion.goal?.toArray()).toEqual([0.6, 0, -0.4])
    expect(second.behaviour.perk).toBe(1)
    callOver([first, second], 0, 0.2, 0.3, opts)
    expect(first.motion.goal?.toArray()).toEqual([0.2, 0, 0.3])
    expect(second.motion.goal?.toArray()).toEqual([0.6, 0, -0.4])
  })

  it('sends the only puppy in the room whatever is selected', () => {
    const only = pup()
    callOver([only], 1, 0.6, -0.4, opts)
    expect(only.motion.goal?.toArray()).toEqual([0.6, 0, -0.4])
  })

  it('leaves a puppy in its brushing where it is', () => {
    const held = pup()
    held.routine.held = 'brushing'
    callOver([held, pup()], 0, 0.6, -0.4, opts)
    expect(held.motion.goal).toBeNull()
  })
})

describe('hearing the player', () => {
  const pup = () => ({
    motion: createMotionState(),
    behaviour: createBehaviourState(),
    routine: createRoutineState(),
    care: createCare(BREEDS.shiba, 0),
    fetch: createFetchState(),
  })
  const opts = {
    happy: 0.5,
    energy: 0.5,
    clamp: (x: number, z: number) => [x, z] as [number, number],
  }
  const camera = new THREE.Vector3(0, 1.2, 3)

  it('looks at the player at a loud sound, ears up, unless asleep, held or playing ball', () => {
    const awake = pup()
    expect(hearNoise(awake, camera, 10)).toBe(true)
    expect(awake.behaviour.pointerLook.toArray()).toEqual(camera.toArray())
    expect(awake.behaviour.perk).toBe(1)
    // For about a second and a half of the time a pointer holds its gaze
    expect(10 - awake.behaviour.pointerAt).toBeCloseTo(0.1)

    const asleep = pup()
    asleep.routine.routine = 'sleeping'
    const fetching = pup()
    fetching.fetch.task = 'chase'
    const held = pup()
    held.routine.held = 'bathing'
    for (const p of [asleep, fetching, held]) expect(hearNoise(p, camera, 10)).toBe(false)
  })

  it('comes hopping when called by sounds, gladder than it was', () => {
    const p = pup()
    expect(comeHopping(p, 0.4, -0.2, opts)).toBe(true)
    expect(p.motion.goal?.toArray()).toEqual([0.4, 0, -0.2])
    expect(p.motion.next).toBe('hop')
    expect(p.behaviour.happy).toBeGreaterThan(createBehaviourState().happy)
  })

  it('wakes from a nap by day to come, but sleeps on at night', () => {
    const napping = pup()
    napping.routine.routine = 'sleeping'
    napping.routine.nap = 'floor'
    expect(comeHopping(napping, 0.4, -0.2, opts)).toBe(true)
    expect(napping.routine.routine).toBe('stretch')

    const night = pup()
    night.routine.routine = 'sleeping'
    expect(comeHopping(night, 0.4, -0.2, opts)).toBe(false)
    expect(night.routine.routine).toBe('sleeping')
    expect(night.motion.goal).toBeNull()
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

  it('lets two puppies differ: minutes of petting one leave it happier, and not pinned at 1', () => {
    const DT = 1 / 30
    const puppy = () => {
      const v = cheery()
      v.moodWas = v.behaviour.happy
      const rig = behaviourRig(BREEDS.shiba, BREEDS.shiba.defaultPersona, anatomy(BREEDS.shiba))
      const input: BehaviourInput = {
        now: 0,
        petting: false,
        petHeadX: 0,
        motion: createMotionState(),
        body: { y: 0, pitch: 0, roll: 0, k: 0 },
        fetch: createFetchState(),
        ball: createBall(),
        camera: new THREE.Vector3(0.9, 0.9, 2.2),
        random: () => 0.5,
      }
      return { v, rig, input }
    }
    const petted = puppy(),
      other = puppy(),
      point = new THREE.Vector3()
    const happiness = new Map<number, [number, number]>()
    let passing = 0
    // Strokes of 1.5 s with a pause of 2 s between them, and the room's drift every 10 s
    for (let f = 1; f * DT <= 300; f++) {
      const t = f * DT,
        stroking = t % 3.5 < 1.5
      if (stroking && !petted.input.petting) startPet(petted.v.behaviour, 'back', point, t)
      if (!stroking && petted.input.petting) endPet(petted.v.behaviour)
      petted.input.petting = stroking
      if (stroking) movePet(petted.v.behaviour, 'back', point, t, 6)
      for (const { v, rig, input } of [petted, other]) {
        input.now = t
        stepBehaviour(rig, v.behaviour, input, DT, t)
        cheerUp(v)
      }
      passing += DT
      if (passing >= 10) {
        for (const { v } of [petted, other]) v.care = settle(v.care, passing)
        passing = 0
      }
      if (f % (60 / DT) === 0)
        happiness.set(t / 60, [petted.v.care.happiness, other.v.care.happiness])
    }
    const [mine, theirs] = happiness.get(5)!
    expect(mine - theirs).toBeGreaterThanOrEqual(0.15)
    for (const [mine] of happiness.values()) expect(mine).toBeLessThan(0.95)
    expect(happiness.get(3)![0]).toBeLessThan(happiness.get(5)![0])
  })
})

describe('dropFetch', () => {
  it('lets go of a ball it was bringing back and is free at once', () => {
    const fetch = createFetchState(),
      motion = createMotionState(),
      ball = createBall()
    fetch.task = 'return'
    fetch.holding = true
    ball.state = 'mouth'
    motion.goal = new THREE.Vector3(1, 0, 1)
    dropFetch({ fetch, motion }, ball)
    expect([fetch.task, fetch.holding, ball.state, motion.goal]).toEqual([
      'free',
      false,
      'air',
      null,
    ])
  })

  it('gives up a chase and leaves the ball rolling', () => {
    const fetch = createFetchState(),
      ball = createBall()
    fetch.task = 'chase'
    ball.state = 'air'
    dropFetch({ fetch, motion: createMotionState() }, ball)
    expect([fetch.task, ball.state]).toEqual(['free', 'air'])
  })
})

describe('putToBed', () => {
  it('carries a puppy in its bath with the ball to its bed, asleep, the ball put away', () => {
    const A = anatomy(BREEDS.shiba)
    const motion = createMotionState()
    motion.pos.set(-0.4, 0, 0.6)
    const v = {
      motion,
      legs: createLegStates(legRigs(A), motion),
      fetch: createFetchState(),
      routine: createRoutineState(),
      bath: createBath(),
      brush: createBrush(),
      coatTouch: null,
    }
    beginBath(v.bath)
    holdStill(v.routine, motion, 'bathing')
    v.fetch.holding = true
    const ball = createBall()
    ball.state = 'mouth'
    const slot = bedSlots(computeSpots(fitCamera(createCamera(), 0.46), 1))[0]!
    putToBed(v, slot, ball)
    expect([v.routine.routine, motion.pose, v.bath.phase, ball.state]).toEqual([
      'sleeping',
      'sleep',
      'off',
      'none',
    ])
    expect([motion.pos.x, motion.pos.z, motion.heading]).toEqual([slot.x, slot.z, slot.heading])
    for (const L of v.legs) expect(Math.hypot(L.pos.x - slot.x, L.pos.z - slot.z)).toBeLessThan(0.6)
  })
})

describe('rebed', () => {
  const sleeper = (place: number) => {
    const motion = createMotionState()
    const v = {
      motion,
      legs: createLegStates(legRigs(anatomy(BREEDS.dorado)), motion),
      fetch: createFetchState(),
      routine: createRoutineState(),
      bath: createBath(),
      brush: createBrush(),
      coatTouch: null,
      place,
    }
    return v
  }

  it('lays each sleeper in its new bed as a fresh sleeper, and leaves the awake ones be', () => {
    const cam = fitCamera(createCamera(), 1)
    const [alone] = bedSlots(computeSpots(cam, 1))
    const ball = createBall()
    const first = sleeper(0),
      second = sleeper(1)
    putToBed(first, alone!, ball)
    second.motion.pos.set(0.3, 0, 0.2)

    const spots = computeSpots(cam, 2)
    rebed([first, second], spots, ball)
    const [left] = bedSlots(spots)
    expect([first.motion.pos.x, first.motion.pos.z, first.motion.heading]).toEqual([
      left!.x,
      left!.z,
      left!.heading,
    ])
    expect([first.routine.side, first.motion.sleepSide]).toEqual([-1, -1])
    expect([second.routine.routine, second.motion.pos.x]).toEqual(['none', 0.3])
  })
})

describe('showCare', () => {
  // A column of fur from the floor up: dirt settles from the bottom
  const n = 200
  const position = new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? Math.floor(i / 3) / n : 0))
  const normal = new Float32Array(n * 3).map((_, i) => (i % 3 === 0 ? 1 : 0))
  const rest = dirtRest(position, normal, [0, 2, 0])
  const shown = (care = createCare(BREEDS.shiba, 0)) => ({ care, coat: createCoat(rest, care) })

  it('spreads the dirt and dries the coat to match a care caught up after time away', () => {
    const v = shown({ ...createCare(BREEDS.shiba, 0), wet: 0.8 })
    v.coat.wet.fill(0.8)
    const back = { ...v.care, cleanliness: 0.7, wet: 0 }
    showCare(v, back)
    expect(v.care).toBe(back)
    expect(meanDirt(v.coat.dirt.field)).toBeCloseTo(0.3, 2)
    expect(Math.max(...v.coat.wet)).toBe(0)
    expect(v.coat.dirty).toBe(true)
  })

  it('keeps the dirt where it is when time away barely changed it', () => {
    const v = shown()
    v.coat.dirt.field[0] = 0.5
    const before = Float32Array.from(v.coat.dirt.field)
    showCare(v, { ...v.care, cleanliness: 0.999, hunger: 0.9 })
    expect(v.coat.dirt.field).toEqual(before)
  })
})

describe('mayStepAside', () => {
  const idle = () => ({
    motion: createMotionState(),
    routine: createRoutineState(),
    behaviour: createBehaviourState(),
  })
  const now = 100

  it('lets a puppy standing about with nothing to do step aside', () => {
    expect(mayStepAside(idle(), { petting: null, now })).toBe(true)
  })

  it('never moves one being petted, or touched a moment ago', () => {
    const v = idle()
    expect(mayStepAside(v, { petting: v as never, now })).toBe(false)
    v.behaviour.petLast = now - 1
    expect(mayStepAside(v, { petting: null, now })).toBe(false)
    v.behaviour.petLast = now - 5
    expect(mayStepAside(v, { petting: null, now })).toBe(true)
  })

  it('never stands up one doing a trick', () => {
    for (const pose of ['sit', 'lie', 'belly'] as const) {
      const v = idle()
      setPose(v.motion, pose)
      expect(mayStepAside(v, { petting: null, now })).toBe(false)
    }
  })

  it('never takes one from its meal, the scale, its business or the bath', () => {
    for (const routine of ['eating', 'onScale', 'relieving', 'splashing', 'sleeping'] as const) {
      const v = idle()
      v.routine.routine = routine
      expect(mayStepAside(v, { petting: null, now })).toBe(false)
    }
    const weighed = idle()
    goWeigh(weighed.routine, weighed.motion)
    expect(weighing(weighed.routine)).toBe(true)
    expect(mayStepAside(weighed, { petting: null, now })).toBe(false)
    const bathed = idle()
    holdStill(bathed.routine, bathed.motion, 'bathing')
    expect(mayStepAside(bathed, { petting: null, now })).toBe(false)
  })
})
