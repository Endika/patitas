// @vitest-environment node
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BREEDS, type Persona } from '@/domain/breeds'
import { createFetchState, type FetchTask } from '@/engine/motion/fetch'
import { createMotionState, type BodyPose } from '@/engine/motion/locomotion'
import { POSE_TIME, setPose, stepPoses } from '@/engine/motion/poses'
import { anatomy, type ZoneId } from '@/engine/puppy/anatomy'
import {
  behaviourRig,
  createBehaviourState,
  DIG,
  LID_SHUT,
  pickHint,
  movePet,
  startPet,
  stepBehaviour,
  type BehaviourInput,
  type BehaviourState,
} from '@/engine/puppy/behaviour'
import { createBall } from '@/engine/room/ball'
import { SHAKE_TIME } from '@/engine/room/bath'

const DT = 1 / 60
const EARS = anatomy(BREEDS.dorado).ears
const STILL: BodyPose = { y: 0, pitch: 0, roll: 0, k: 0 }

function world(persona: Persona = BREEDS.dorado.defaultPersona, task: FetchTask = 'free') {
  const rig = behaviourRig(BREEDS.dorado, persona, { look: [0, 0.62, 0.43], ears: EARS })
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
      const { rig, s, input } = world({ energy, cuddly: 0.5, curious: 0.5, bath: 0.5, social: 0.5 })
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

  it('sleeps curled up: lids shut, head turned onto the paws, tail round the body, slow breath', () => {
    const run = (sleep: boolean) => {
      const { rig, s, input } = world()
      if (sleep) setPose(input.motion, 'sleep')
      input.motion.sleepW = sleep ? 1 : 0
      input.motion.fk = sleep ? 1 : 0
      let lid = -Infinity
      let pose = stepBehaviour(rig, s, input, DT, 0)
      for (let f = 1; f <= 600; f++) {
        input.now = f * DT
        pose = stepBehaviour(rig, s, input, DT, input.now)
        lid = Math.max(lid, pose.lid)
      }
      return { s, pose, lid }
    }
    const awake = run(false),
      asleep = run(true)
    expect(asleep.pose.lid).toBeCloseTo(LID_SHUT, 5)
    expect(asleep.pose.jaw).toBeLessThan(0.01)
    expect(asleep.pose.head[1] + asleep.pose.neck[1]).toBeGreaterThan(0.4)
    expect(asleep.pose.head[0] + asleep.pose.neck[0]).toBeGreaterThan(0.3)
    expect(asleep.pose.tail[0][1]).toBeGreaterThan(0.8)
    expect(asleep.s.breath).toBeLessThan(awake.s.breath * 0.5)
    expect(asleep.s.breath / 10).toBeCloseTo(0.7, 1)
  })

  it('eats with the head down, chewing at 3 Hz with the jaw up to 0.12', () => {
    const { rig, s, input } = world()
    input.routine = 'eating'
    let lo = Infinity,
      hi = -Infinity,
      opens = 0,
      was = 0,
      down = Infinity
    for (let f = 1; f <= 240; f++) {
      input.now = f * DT
      const pose = stepBehaviour(rig, s, input, DT, input.now)
      if (f < 60) continue
      lo = Math.min(lo, pose.jaw)
      hi = Math.max(hi, pose.jaw)
      if (pose.jaw > 0.06 && was <= 0.06) opens++
      was = pose.jaw
      down = Math.min(down, pose.head[0] + pose.neck[0])
    }
    expect(lo).toBeLessThan(0.015)
    expect(hi).toBeGreaterThan(0.1)
    expect(hi).toBeLessThanOrEqual(0.12)
    // Three seconds of chewing at 3 Hz
    expect(opens).toBeGreaterThanOrEqual(8)
    expect(opens).toBeLessThanOrEqual(10)
    expect(down).toBeGreaterThan(0.75)
  })

  it('begs looking at the camera with its head tilted', () => {
    const { rig, s, input } = world()
    input.routine = 'begging'
    let tilt = 0,
      pose = stepBehaviour(rig, s, input, DT, 0)
    for (let f = 1; f <= 120; f++) {
      input.now = f * DT
      pose = stepBehaviour(rig, s, input, DT, input.now)
      tilt = Math.max(tilt, Math.abs(s.roll.x))
    }
    expect(pose.target.distanceTo(input.camera)).toBeLessThan(1e-9)
    expect(tilt).toBeGreaterThan(0.15)
  })

  it('in the puddle it looks down at the mud in front of its paws', () => {
    const { rig, s, input } = world()
    input.routine = 'splashing'
    let pose = stepBehaviour(rig, s, input, DT, 0)
    for (let f = 1; f <= 120; f++) {
      input.now = f * DT
      pose = stepBehaviour(rig, s, input, DT, input.now)
    }
    expect(pose.target.y).toBeLessThan(0.1)
    expect(pose.head[0] + pose.neck[0]).toBeGreaterThan(0.4)
  })

  it('rolling in it, it lies on its side and wriggles towards its back and down again', () => {
    const { rig, s, input } = world()
    input.routine = 'splashing'
    const M = input.motion
    setPose(M, 'roll')
    const turns: number[] = []
    for (let f = 1; f * DT <= POSE_TIME.roll; f++) {
      input.now = f * DT
      stepPoses(M, DT)
      turns.push(stepBehaviour(rig, s, input, DT, input.now).spine[2])
    }
    const settled = turns.slice(Math.round(0.6 / DT))
    // On its side (a quarter turn) at least, never belly up as a trick shows it (2.7)
    expect(Math.min(...settled)).toBeGreaterThan(1.2)
    expect(Math.max(...settled)).toBeLessThan(2.4)
    expect(Math.max(...settled) - Math.min(...settled)).toBeGreaterThan(0.5)
  })

  it('digging, it looks down and its front paws scrape in turn', () => {
    const { rig, s, input } = world()
    input.routine = 'splashing'
    setPose(input.motion, 'dig')
    let pose = stepBehaviour(rig, s, input, DT, 0)
    const left: number[] = [],
      right: number[] = []
    for (let f = 1; f * DT <= POSE_TIME.dig; f++) {
      input.now = f * DT
      pose = stepBehaviour(rig, s, input, DT, input.now)
      left.push(pose.digLegs[0][0])
      right.push(pose.digLegs[1][0])
    }
    expect(pose.dig).toBeGreaterThan(0.95)
    expect(pose.head[0] + pose.neck[0]).toBeGreaterThan(0.45)
    // Each paw reaches forward and pulls back several times, one while the other pulls
    const strokes = (xs: number[]) =>
      xs.filter((x, i) => i > 0 && x < -0.2 && xs[i - 1]! >= -0.2).length
    expect(strokes(left)).toBeGreaterThanOrEqual(3)
    left.forEach((l, i) => expect(l + right[i]!).toBeCloseTo(DIG.reach[0] + DIG.pull[0], 9))
    // Standing again, the legs are its own
    setPose(input.motion, 'stand')
    for (let f = 0; f < 60; f++) pose = stepBehaviour(rig, s, input, DT, 3 + f * DT)
    expect(pose.dig).toBeLessThan(0.01)
  })

  it('writes the dig strokes into the same two arrays every frame', () => {
    const { rig, s, input } = world()
    const first = stepBehaviour(rig, s, input, DT, 0).digLegs
    const next = stepBehaviour(rig, s, input, DT, DT).digLegs
    expect(next).toBe(first)
    expect(next[0]).toBe(first[0])
    expect(next[1]).toBe(first[1])
  })
})

describe('bath', () => {
  /** Rolls of the spine each frame for `secs`, with `set` changing the input first. */
  const rolls = (
    secs: number,
    set: (input: BehaviourInput, t: number) => void,
    persona?: Persona,
  ) => {
    const { rig, s, input } = world(persona)
    const out: number[] = []
    for (let f = 1; f * DT <= secs; f++) {
      input.now = f * DT
      set(input, input.now)
      out.push(stepBehaviour(rig, s, input, DT, input.now).spine[2])
    }
    return out
  }
  const crossings = (xs: number[]) =>
    xs.filter((x, i) => i > 0 && Math.sign(x) !== Math.sign(xs[i - 1]!)).length
  const most = (xs: number[]) => Math.max(...xs.map(Math.abs))

  it('shakes its body ±0.5 rad at 9 Hz for 1.2 s', () => {
    const shake = rolls(SHAKE_TIME, (input, t) => {
      input.routine = 'bathing'
      input.bath = { phase: 'shake', t, touched: false }
    })
    expect(most(shake)).toBeGreaterThan(0.45)
    expect(most(shake)).toBeLessThanOrEqual(0.5 + 1e-9)
    expect(crossings(shake)).toBeGreaterThanOrEqual(19)
    expect(crossings(shake)).toBeLessThanOrEqual(22)
  })

  it('ended mid-shake, the body eases back instead of snapping upright', () => {
    const roll = rolls(SHAKE_TIME, (input, t) => {
      input.routine = t < 0.325 ? 'bathing' : undefined
      input.bath = { phase: t < 0.325 ? 'shake' : 'off', t, touched: false }
    })
    // From the last frame of the shake on, frame 19, well into a swing
    const after = roll.slice(18)
    expect(Math.abs(after[0]!)).toBeGreaterThan(0.2)
    const jumps = after.slice(1).map((r, i) => Math.abs(r - after[i]!))
    expect(Math.max(...jumps)).toBeLessThan(0.15)
    expect(Math.abs(roll.at(-1)!)).toBeLessThan(0.01)
  })

  it('trembles a little at 12 Hz while wet, and not at all once dry', () => {
    const wet = rolls(1, (input) => (input.wet = 1))
    expect(most(wet)).toBeGreaterThan(0.005)
    expect(most(wet)).toBeLessThan(0.05)
    expect(crossings(wet)).toBeGreaterThanOrEqual(22)
    expect(crossings(wet)).toBeLessThanOrEqual(25)
    expect(most(rolls(1, (input) => (input.wet = 0)))).toBe(0)
    // Damp is not wet: it stops trembling well before it is dry
    expect(most(rolls(1, (input) => (input.wet = 0.28)))).toBe(0)
  })

  it('wet, one who hates the bath trembles more', () => {
    const wet = (input: BehaviourInput) => (input.wet = 1)
    const calm = most(rolls(1, wet, { ...BREEDS.dorado.defaultPersona, bath: 0.5 })),
      hates = most(rolls(1, wet, { ...BREEDS.dorado.defaultPersona, bath: 0.1 }))
    expect(hates).toBeGreaterThan(calm * 1.5)
  })

  /** Rubbed in the bath for `secs` with `persona`: its mood, ears and gaze. */
  const bathed = (persona: Persona, secs: number, touched = true) => {
    const { rig, s, input } = world(persona)
    input.routine = 'bathing'
    const happy = s.happy
    let pose = stepBehaviour(rig, s, input, DT, 0)
    const yaws: number[] = [],
      rolls: number[] = []
    for (let f = 1; f * DT <= secs; f++) {
      input.now = f * DT
      input.bath = { phase: 'scrub', t: input.now, touched }
      pose = stepBehaviour(rig, s, input, DT, input.now)
      yaws.push(s.yaw.x)
      rolls.push(pose.spine[2])
    }
    return { gain: s.happy - happy, pose, yaws, rolls }
  }
  const withBath = (bath: number) => ({ energy: 0.5, cuddly: 0.5, curious: 0.5, bath, social: 0.5 })
  const LIKES = withBath(0.9),
    DISLIKES = withBath(0.3),
    NEUTRAL = withBath(0.5),
    HATES = withBath(0.1)

  it('a puppy who likes the bath wags; one who does not puts its ears back and looks away', () => {
    const likes = bathed(LIKES, 3),
      dislikes = bathed(DISLIKES, 3),
      untouched = bathed(LIKES, 3, false)
    expect(likes.gain).toBeGreaterThan(untouched.gain + 0.1)
    expect(dislikes.gain).toBeLessThanOrEqual(untouched.gain + 1e-9)
    for (const ear of dislikes.pose.ears) expect(ear.base[0]).toBeLessThan(-0.2)
    for (const ear of likes.pose.ears) expect(ear.base[0]).toBeGreaterThan(-0.1)
    // A brief look away when the rubbing starts, then back
    const away = (r: ReturnType<typeof bathed>) => Math.max(...r.yaws.slice(0, 50).map(Math.abs))
    expect(away(dislikes)).toBeGreaterThan(away(likes) + 0.3)
    expect(Math.abs(dislikes.yaws.at(-1)! - likes.yaws.at(-1)!)).toBeLessThan(0.05)
  })

  it('the fonder of the bath, the gladder rubbing it makes it', () => {
    const gains = [0.6, 0.8, 1].map((bath) => bathed(withBath(bath), 3).gain)
    expect(gains[1]!).toBeGreaterThan(gains[0]! + 0.02)
    expect(gains[2]!).toBeGreaterThan(gains[1]! + 0.02)
  })

  it('one half fond of the bath is neither glad nor put out by it', () => {
    const neutral = bathed(NEUTRAL, 3),
      untouched = bathed(NEUTRAL, 3, false)
    expect(Math.abs(neutral.gain - untouched.gain)).toBeLessThan(1e-9)
    for (const ear of neutral.pose.ears) expect(ear.base[0]).toBeGreaterThan(-0.1)
  })

  it('one who hates the bath wriggles when the rubbing starts, and never minds it more for it', () => {
    const hates = bathed(HATES, 3),
      dislikes = bathed(DISLIKES, 3),
      untouched = bathed(HATES, 3, false)
    expect(hates.gain).toBeCloseTo(untouched.gain, 9)
    const swing = (r: ReturnType<typeof bathed>, from: number, to: number) => {
      const part = r.rolls.slice(from, to)
      return Math.max(...part) - Math.min(...part)
    }
    expect(swing(hates, 0, 40)).toBeGreaterThan(swing(dislikes, 0, 40) + 0.05)
    // Settled again once the wriggle is over
    expect(swing(hates, 120, 180)).toBeLessThan(0.01)
  })
})

describe('brushing', () => {
  /** Brushed for `secs` with `persona` on `side`: how much happier, and how far the head leans. */
  const brushed = (persona: Persona, secs: number, touched = true, side = 1) => {
    const { rig, s, input } = world(persona)
    input.routine = 'brushing'
    const happy = s.happy
    for (let f = 1; f * DT <= secs; f++) {
      input.now = f * DT
      input.brush = { touched, side }
      stepBehaviour(rig, s, input, DT, input.now)
    }
    return { gain: s.happy - happy, lean: s.lean }
  }
  const FOND = { energy: 0.5, cuddly: 0.9, curious: 0.5, bath: 0.5, social: 0.5 },
    SHY = { energy: 0.5, cuddly: 0.1, curious: 0.5, bath: 0.5, social: 0.5 }

  it('every puppy enjoys it, a cuddly one more, and leans into the brush', () => {
    const fond = brushed(FOND, 3),
      shy = brushed(SHY, 3),
      untouched = brushed(FOND, 3, false)
    expect(shy.gain).toBeGreaterThan(untouched.gain + 0.03)
    expect(fond.gain).toBeGreaterThan(shy.gain + 0.05)
    expect(fond.lean).toBeGreaterThan(0.1)
    expect(brushed(FOND, 3, true, -1).lean).toBeLessThan(-0.1)
    expect(Math.abs(shy.lean)).toBeLessThan(fond.lean / 3)
    expect(untouched.lean).toBeCloseTo(0, 3)
  })
})

describe('pickHint', () => {
  it('says the puppy is asleep', () => {
    const motion = createMotionState()
    setPose(motion, 'sleep')
    expect(
      pickHint('idle', { fetch: createFetchState(), motion, zone: null, scratch: 0, sincePet: 9 }),
    ).toBe('sleep')
  })
})
