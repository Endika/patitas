import * as THREE from 'three'
import type { Breed, Persona } from '@/domain/breeds'
import { clamp, damp, type Vec3 } from '@/engine/math'
import type { FetchState } from '@/engine/motion/fetch'
import type { BodyPose, MotionState } from '@/engine/motion/locomotion'
import { setPose } from '@/engine/motion/poses'
import type { Routine } from '@/engine/motion/routine'
import type { BallState } from '@/engine/room/ball'
import { SHAKE_HZ, SHAKE_ROLL, SHAKE_TIME, TREMBLE_HZ, type BathPhase } from '@/engine/room/bath'
import type { Anatomy, ZoneId } from './anatomy'
import { sm } from './sdf'

export const LID_OPEN = -0.62,
  LID_SHUT = 0.55,
  LOW_LID = 0.44

/** Seconds a caress keeps counting after the last stroke. */
const PET_GRACE = 0.35
/** Seconds the pointer keeps the puppy's attention after it last moved. */
export const POINTER_ATTENTION = 1.6
const SCRATCH_AFTER = 0.7
const BLINK = 0.14
const YAWN = 1.8
/** Eating: head down over the bowl with a little bob, the jaw chewing 0 to CHEW at CHEW_HZ. */
const EAT_PITCH = 0.9
const EAT_BOB = { amp: 0.07, hz: 1.3 }
const CHEW = 0.12,
  CHEW_HZ = 3
/** In the puddle: the head dips at the mud with a quick sniffing nod. */
const MUD_PITCH = 0.75,
  MUD_NOD = { amp: 0.08, hz: 2.2 }
/**
 * Rolling in it: the body turns onto its side and wriggles towards its back and down again, the
 * legs kicking; radians of the turn, how far it wriggles on from there, and how often.
 */
const ROLL = { side: 1.45, wriggle: 0.75, hz: 1.4 }
/**
 * Digging in it: head down at the hole, the front paws scrape in turn, each reaching forward
 * lifted and pulling back along the ground; [upper, middle, paw] rotations at the reach and at the
 * pull, and strokes a second.
 */
export const DIG = {
  pitch: 0.95,
  reach: [-0.75, 0.95, 0.7],
  pull: [0.3, 0.05, -0.2],
  hz: 3,
} as const
/**
 * The more it likes its bath above half, the happier rubbing it makes it, up to BATH_JOY a second.
 * Below BATH_DISLIKE it puts its ears back and looks away, and below BATH_HATE it wriggles too
 * when the rubbing starts and trembles more wet. Its mood never drops for being bathed.
 */
const BATH_JOY = 0.08,
  BATH_DISLIKE = 0.4,
  BATH_HATE = 0.25
/** The wriggle of one who hates its bath: seconds, roll and beat. */
const WRIGGLE = 0.8,
  WRIGGLE_ROLL = 0.07,
  WRIGGLE_HZ = 4
/** How much more one who hates its bath trembles wet. */
const HATE_TREMBLE = 1.8
/**
 * Every puppy enjoys the brush, a cuddly one more: happiness a second at no cuddliness and on top
 * at full, and how far its head leans into the brush at full.
 */
const BRUSH_JOY = 0.03,
  BRUSH_FONDNESS = 0.09,
  BRUSH_LEAN = 0.25
/** One who does not puts its ears back and looks away for a moment when the rubbing starts. */
const LOOK_AWAY = 0.9,
  LOOK_AWAY_YAW = 1
/** Seconds the shake takes to build up and to die down. */
const SHAKE_EASE = 0.12
/** How fast a shake cut short settles. */
const SHAKE_SETTLE = 10
/** Wet through, it trembles this much; merely damp, up to DAMP, not at all. */
const TREMBLE = 0.02,
  DAMP = 0.3
/** Asking for food: the head tips to one side, then the other. */
const BEG_TILT = 0.24
/** Asleep: the head turns onto the front paws and the tail wraps round the body. */
export const SLEEP = {
  neck: [0.35, 0.25],
  head: [0.25, 0.3],
  tail: [1, 1, 0.75, 0.55],
  breath: 0.7,
} as const

/** The share of the body's pitch the neck and the head turn back, so the gaze stays level. */
export const NECK_LEVEL = 0.4,
  HEAD_LEVEL = 0.3

/** What behaviour needs to know about a puppy besides its state. */
export interface BehaviourRig {
  persona: Persona
  ear: 'floppy' | 'erect'
  /** Which side each ear is on (+1 left, −1 right), in the anatomy's order. */
  earSides: readonly number[]
  tail: 'flag' | 'curl'
  /** Point the head aims from, in the puppy's frame. */
  look: Vec3
}

export function behaviourRig(
  breed: Breed,
  persona: Persona,
  { look, ears }: Pick<Anatomy, 'look' | 'ears'>,
): BehaviourRig {
  return {
    persona,
    ear: breed.shape.ear,
    earSides: ears.map((e) => e.s),
    tail: breed.shape.tail,
    look: new THREE.Vector3(...look),
  }
}

interface Spring {
  x: number
  v: number
}

interface EarSpring {
  a: number
  v: number
  ta: number
  tv: number
}

export interface BehaviourState {
  yaw: Spring
  pitch: Spring
  roll: Spring
  happy: number
  wag: number
  breath: number
  blinkT: number
  blink: number
  bliss: number
  tilt: number
  tiltT: number
  perk: number
  sniffT: number
  scratch: number
  pant: number
  lean: number
  yawnT: number
  yawnEyes: number
  jaw: number
  /** Zone under the hand at the last stroke; times are in seconds. */
  zone: ZoneId | null
  petLast: number
  petStart: number
  petPoint: Vec3
  stroke: number
  /** Where the pointer last pointed, on a plane through the puppy's look point. */
  pointerLook: Vec3
  pointerAt: number
  idleT: number
  idle: Vec3
  idleCam: boolean
  ears: [EarSpring, EarSpring]
  lastYawV: number
  twitchT: number
  twitch: number
  twitchSide: number
  saccT: number
  sacc: { x: number; y: number }
  /** Rubbed in the bath last frame; seconds left looking away and wriggling; ears back, 0 to 1. */
  bathRubbed: boolean
  lookAwayT: number
  wriggleT: number
  earsBack: number
  /** The body's roll from shaking itself dry. */
  shakeRoll: number
  /** How far into digging the front legs are, 0 to 1. */
  dig: number
  /** Each front leg's dig stroke this frame, written in place rather than built. */
  digLegs: [Rot, Rot]
}

export function createBehaviourState(): BehaviourState {
  const ear = (): EarSpring => ({ a: 0, v: 0, ta: 0, tv: 0 })
  return {
    yaw: { x: 0, v: 0 },
    pitch: { x: 0, v: 0 },
    roll: { x: 0, v: 0 },
    happy: 0.25,
    wag: 0,
    breath: 0,
    blinkT: 2,
    blink: 0,
    bliss: 0,
    tilt: 0,
    tiltT: 0,
    perk: 0,
    sniffT: 0,
    scratch: 0,
    pant: 0,
    lean: 0,
    yawnT: 0,
    yawnEyes: 0,
    jaw: 0,
    zone: null,
    petLast: -1e9,
    petStart: 0,
    petPoint: new THREE.Vector3(),
    stroke: 0,
    pointerLook: new THREE.Vector3(),
    pointerAt: -1e9,
    idleT: 1.5,
    idle: new THREE.Vector3(),
    idleCam: true,
    ears: [ear(), ear()],
    lastYawV: 0,
    twitchT: 4,
    twitch: 0,
    twitchSide: 0,
    saccT: 0,
    sacc: { x: 0, y: 0 },
    bathRubbed: false,
    lookAwayT: 0,
    wriggleT: 0,
    earsBack: 0,
    shakeRoll: 0,
    dig: 0,
    digLegs: [
      [0, 0, 0],
      [0, 0, 0],
    ],
  }
}

/** The back and the belly are one caress: moving between them keeps the scratch count. */
const caressGroup = (z: ZoneId | null) => (z === 'belly' ? 'back' : z)

/** The hand lands on the puppy. */
export function startPet(s: BehaviourState, zone: ZoneId, point: Vec3, now: number): void {
  s.petStart = now
  s.petLast = now
  s.zone = zone
  s.petPoint.copy(point)
}

/** A stroke of `px` screen pixels over `zone`; returns true when it earns a heart. */
export function movePet(
  s: BehaviourState,
  zone: ZoneId,
  point: Vec3,
  now: number,
  px: number,
): boolean {
  if (caressGroup(zone) !== caressGroup(s.zone)) s.petStart = now
  s.zone = zone
  s.petLast = now
  s.petPoint.copy(point)
  s.happy = Math.min(1, s.happy + px * 0.0009)
  s.stroke += px
  if (s.stroke <= 70) return false
  s.stroke = 0
  return true
}

export function endPet(s: BehaviourState): void {
  s.zone = null
}

export function yawn(s: BehaviourState): void {
  s.yawnT = YAWN
}

/** A tap the puppy cannot act on: it tilts its head, curious. */
export function puzzle(s: BehaviourState, random: () => number = Math.random): void {
  s.tilt = random() < 0.5 ? 0.38 : -0.38
  s.tiltT = 1.4
  s.perk = 1
}

export interface BehaviourInput {
  /** Seconds, on the same clock as startPet and movePet. */
  now: number
  /** The finger is down and stroking the puppy. */
  petting: boolean
  /** X of the stroke point in the head bone's frame: the puppy leans into the hand. */
  petHeadX: number
  motion: MotionState
  body: BodyPose
  fetch: FetchState
  ball: BallState
  camera: Vec3
  /** What its own routine has it doing: eating and asking for food move the head and jaw. */
  routine?: Routine
  /** Its bath, if any: the phase, seconds in it, and whether the finger is at work on it. */
  bath?: { phase: BathPhase; t: number; touched: boolean }
  /** How wet its coat is, 0 to 1: wet, it trembles. */
  wet?: number
  /** Being brushed: whether it feels a stroke now, and on which side, +1 its left. */
  brush?: { touched: boolean; side: number }
  random?: () => number
}

type Rot = [number, number, number]

/** Bone rotations (YXZ Euler) and offsets for one frame. */
export interface BehaviourPose {
  /** World point the head and eyes turn to. */
  target: Vec3
  zone: ZoneId | null
  neck: Rot
  head: Rot
  spine: Rot
  spineDy: number
  chestDy: number
  pelvis: Rot
  scratch: number
  tail: [Rot, Rot, Rot]
  ears: { base: Rot; tip: Rot }[]
  jaw: number
  tongue: number
  lid: number
  lowLid: number
  sacc: { x: number; y: number }
  /** Digging: how much its front legs dig, and each one's [upper, middle, paw] rotations. */
  dig: number
  digLegs: [Rot, Rot]
}

const spring = (s: Spring, target: number, k: number, c: number, dt: number) => {
  s.v += ((target - s.x) * k - s.v * c) * dt
  s.x += s.v * dt
}

const tmp = new THREE.Vector3()

/** One frame of the puppy's character: gaze, mood, blinking, ears, tail, mouth and the scratch reflex. */
export function stepBehaviour(
  rig: BehaviourRig,
  s: BehaviourState,
  input: BehaviourInput,
  dt: number,
  t: number,
): BehaviourPose {
  const { now, motion: M, body, fetch, ball } = input
  const random = input.random ?? Math.random
  const P = rig.persona
  const petting = input.petting && now - s.petLast < PET_GRACE
  const zone = petting ? s.zone : null
  const petHead = zone === 'head' || zone === 'ears'
  const task = fetch.task
  const asleep = M.pose === 'sleep',
    sw = M.sleepW
  const eating = input.routine === 'eating',
    begging = input.routine === 'begging',
    splashing = input.routine === 'splashing',
    greeting = input.routine === 'greeting' || input.routine === 'greeted'
  const bath = input.bath && input.bath.phase !== 'off' ? input.bath : null
  const dislikesBath = P.bath < BATH_DISLIKE,
    hatesBath = P.bath < BATH_HATE
  const rubbed = !!bath?.touched,
    brushed = !!input.brush?.touched
  if (rubbed && !s.bathRubbed && dislikesBath) s.lookAwayT = LOOK_AWAY
  if (rubbed && !s.bathRubbed && hatesBath) s.wriggleT = WRIGGLE
  s.bathRubbed = rubbed
  s.lookAwayT = Math.max(0, s.lookAwayT - dt)
  s.wriggleT = Math.max(0, s.wriggleT - dt)
  s.earsBack = damp(s.earsBack, bath && dislikesBath ? 1 : 0, 6, dt)

  if ((zone === 'belly' || zone === 'back') && M.pose === 'lie' && s.happy > 0.4)
    setPose(M, 'belly')
  if (M.pose === 'belly' && zone) M.poseT = Math.min(M.poseT, 1)

  // Where it looks
  const target = new THREE.Vector3()
  if (eating || splashing)
    target.set(M.pos.x + Math.sin(M.heading) * 0.45, 0.05, M.pos.z + Math.cos(M.heading) * 0.45)
  // Nose to the other's nose, ahead at its own height
  else if (greeting)
    target.set(M.pos.x + Math.sin(M.heading) * 1.2, 0.3, M.pos.z + Math.cos(M.heading) * 1.2)
  else if (begging || bath || input.brush) target.copy(input.camera)
  else if (task === 'wait' || task === 'chase' || fetch.watch) target.copy(ball.pos)
  else if (task === 'present' || (petting && petHead)) target.copy(input.camera)
  else if (petting) target.copy(s.petPoint)
  else if (task === 'return' || (M.speed > 0.1 && now - s.pointerAt > POINTER_ATTENTION))
    target.set(M.pos.x + Math.sin(M.heading) * 1.2, 0.3, M.pos.z + Math.cos(M.heading) * 1.2)
  else if (now - s.pointerAt < POINTER_ATTENTION) target.copy(s.pointerLook)
  else {
    s.idleT -= dt
    if (s.idleT <= 0 && !asleep) {
      const r = random()
      s.idleT = 1.8 + random() * 2.8
      s.idleCam = r < 0.5
      if (!s.idleCam)
        s.idle.set(
          M.pos.x + (random() - 0.5) * 2.4,
          0.25 + random() * 0.8,
          M.pos.z + 1 + random() * 0.6,
        )
      // Before lying down from boredom it sits for a while
      if (M.pose === 'stand' && random() < 0.12 * P.cuddly)
        setPose(M, 'sit', 2.5 + random() * 3, { pose: 'lie', dur: 6 + random() * 6 })
      if (random() < 0.06) s.yawnT = YAWN
      if (r > 0.82 - 0.1 * P.curious && r < 0.92) s.sniffT = 2.2
      else if (r >= 0.92 - 0.06 * P.curious) {
        s.tilt = random() < 0.5 ? 0.36 : -0.36
        s.tiltT = 1.3
        s.perk = 1
      }
    }
    target.copy(s.idleCam ? input.camera : s.idle)
  }
  // Target in the puppy's frame (the body only turns about Y), relative to its look point
  const dx = target.x - M.pos.x,
    dz = target.z - M.pos.z,
    c = Math.cos(M.heading),
    sn = Math.sin(M.heading)
  tmp.set(dx * c - dz * sn, target.y, dx * sn + dz * c).sub(rig.look)
  let yawT = clamp(Math.atan2(tmp.x, tmp.z), -1.1, 1.1)
  let pitchT = clamp(-Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.55, 0.7)
  s.sniffT = Math.max(0, s.sniffT - dt)
  if (s.sniffT > 0 && task === 'free' && !M.active) {
    pitchT = 0.62
    yawT *= 0.4
  }
  if (zone === 'chest') pitchT -= 0.4
  if (zone === 'muzzle') pitchT = Math.max(pitchT, 0.15)
  if (task === 'grab') {
    pitchT = 1.35
    yawT = 0
  }
  if (eating) {
    pitchT = EAT_PITCH + EAT_BOB.amp * Math.sin(t * 2 * Math.PI * EAT_BOB.hz)
    yawT = 0
  }
  if (splashing) {
    pitchT = MUD_PITCH + MUD_NOD.amp * Math.sin(t * 2 * Math.PI * MUD_NOD.hz)
    yawT *= 0.3
  }
  if (M.pose === 'dig') {
    pitchT = DIG.pitch
    yawT = 0
  }
  if (s.lookAwayT > 0) yawT = -Math.sign(yawT || 1) * LOOK_AWAY_YAW
  spring(s.yaw, yawT, 55, 12, dt)
  spring(s.pitch, pitchT, 55, 12, dt)
  const yawAcc = (s.yaw.v - s.lastYawV) / Math.max(dt, 1e-3)
  s.lastYawV = s.yaw.v

  // Head tilt and leaning into the hand
  if (begging) {
    s.tilt = BEG_TILT * (Math.sin(t * 1.3) >= 0 ? 1 : -1)
    s.tiltT = Math.max(s.tiltT, 0.2)
    s.perk = Math.max(s.perk, 0.5)
  }
  s.tiltT = Math.max(0, s.tiltT - dt)
  if (s.tiltT === 0) s.tilt = 0
  const leanT = petHead
    ? clamp(input.petHeadX * 4, -0.3, 0.3)
    : brushed
      ? BRUSH_LEAN * P.cuddly * input.brush!.side
      : 0
  s.lean = damp(s.lean, leanT, 4, dt)
  spring(s.roll, s.tilt + s.lean, 40, 10, dt)
  s.perk = Math.max(0, s.perk - dt * 0.8)

  // Happiness, breathing and panting
  s.happy = Math.max(0.12, s.happy - dt * (petting || task !== 'free' ? 0 : 0.012))
  if (rubbed) s.happy = Math.min(1, s.happy + dt * BATH_JOY * Math.max(0, (P.bath - 0.5) * 2))
  if (brushed) s.happy = Math.min(1, s.happy + dt * (BRUSH_JOY + BRUSH_FONDNESS * P.cuddly))
  s.pant = damp(s.pant, !asleep && (s.happy > 0.62 || body.k > 0.5) ? 1 : 0, 2, dt)
  s.breath += dt * (1.6 + s.pant * 6.5 + (SLEEP.breath - 1.6 - s.pant * 6.5) * sw)
  const br = Math.sin(s.breath)
  s.wag += dt * (4.5 + 11 * s.happy) * (0.7 + 0.5 * P.energy)
  const amp = 0.1 + 0.62 * s.happy

  // Eyes
  s.blinkT -= dt
  if (s.blinkT <= 0) {
    s.blink = BLINK
    s.blinkT = 1.8 + random() * 4.5
  }
  s.blink = Math.max(0, s.blink - dt)
  const blinkLid = s.blink > 0 ? Math.sin((1 - s.blink / BLINK) * Math.PI) : 0
  s.bliss = damp(s.bliss, petHead ? 0.6 : 0, 5, dt)
  const shut = Math.max(blinkLid, s.bliss)
  s.saccT -= dt
  if (s.saccT <= 0) {
    s.saccT = 0.4 + random() * 1.2
    s.sacc = { x: (random() - 0.5) * 0.06, y: (random() - 0.5) * 0.04 }
  }
  const lid = LID_OPEN + (LID_SHUT - LID_OPEN) * Math.max(shut, s.yawnEyes, sw)
  const lowLid = LOW_LID - 0.14 * s.bliss

  // Body, neck and head
  const sniffNod = s.sniffT > 0 && !M.active ? Math.sin(t * 15) * 0.025 : 0
  const bw = M.bellyW,
    fk = M.fk
  const aw = 1 - sw
  const neck: Rot = [
    (s.pitch.x * 0.4 - body.pitch * NECK_LEVEL) * aw + br * 0.01 + 1.05 * bw + SLEEP.neck[0] * sw,
    s.yaw.x * 0.35 * (1 - bw) * aw + SLEEP.neck[1] * M.sleepSide * sw,
    s.roll.x * 0.3 * aw,
  ]
  const head: Rot = [
    (s.pitch.x * 0.6 * (1 - bw) + sniffNod - body.pitch * HEAD_LEVEL) * aw + SLEEP.head[0] * sw,
    (s.yaw.x * 0.6 * (1 - bw) + 0.55 * bw) * aw + SLEEP.head[1] * M.sleepSide * sw,
    s.roll.x * 0.7 * aw,
  ]
  const shakeT = bath?.phase === 'shake' ? bath.t : -1
  // Cut short, the shake settles back rather than snapping upright
  s.shakeRoll =
    shakeT >= 0
      ? SHAKE_ROLL *
        Math.sin(shakeT * 2 * Math.PI * SHAKE_HZ) *
        sm(0, SHAKE_EASE, shakeT) *
        (1 - sm(SHAKE_TIME - SHAKE_EASE, SHAKE_TIME, shakeT))
      : damp(s.shakeRoll, 0, SHAKE_SETTLE, dt)
  const shakeRoll = s.shakeRoll
  const tremble =
    shakeT >= 0
      ? 0
      : TREMBLE *
        (hatesBath ? HATE_TREMBLE : 1) *
        sm(DAMP, 0.6, input.wet ?? 0) *
        aw *
        Math.sin(t * 2 * Math.PI * TREMBLE_HZ)
  const wriggle = WRIGGLE_ROLL * (s.wriggleT / WRIGGLE) * Math.sin(t * 2 * Math.PI * WRIGGLE_HZ)
  // On its side from the start of the roll, then wriggling towards its back and down again
  const rolled =
    M.rollW * (ROLL.side + ROLL.wriggle * (0.5 - 0.5 * Math.cos(M.poseT * 2 * Math.PI * ROLL.hz)))
  const spine: Rot = [
    body.pitch * (1 - fk),
    s.yaw.x * 0.08 * (1 - fk),
    body.roll * (1 - fk) + bw * 2.7 + rolled + shakeRoll + tremble + wriggle,
  ]
  s.dig = damp(s.dig, M.pose === 'dig' ? 1 : 0, 8, dt)
  for (let i = 0; i < 2; i++) {
    // 1 at the reach, 0 at the pull; the other paw half a stroke behind
    const k = 0.5 + 0.5 * Math.cos(t * 2 * Math.PI * DIG.hz + i * Math.PI),
      leg = s.digLegs[i]!
    for (let j = 0; j < 3; j++) leg[j] = DIG.pull[j]! + (DIG.reach[j]! - DIG.pull[j]!) * k
  }

  // Rump wiggle with the tail, and the scratch reflex: the hind leg moves on its own
  s.scratch = damp(
    s.scratch,
    (zone === 'back' || zone === 'belly') && now - s.petStart > SCRATCH_AFTER && !M.active ? 1 : 0,
    6,
    dt,
  )
  const pelvis: Rot = [
    0,
    -amp * 0.1 * Math.sin(s.wag) * (1 - body.k),
    Math.sin(t * 0.5) * 0.012 + s.scratch * 0.06,
  ]

  // Tail: higher when running, resting on the floor when sitting
  const curl = rig.tail === 'curl' ? 0.45 : 1
  const [tx, ty0, ty1, ty2] = SLEEP.tail
  const tail: [Rot, Rot, Rot] = [
    [
      (-0.1 * s.happy - 0.3 * body.k + 0.5 * (M.sit + 0.8 * fk) * curl) * aw + tx * sw,
      amp * curl * Math.sin(s.wag) * aw + ty0 * sw,
      0,
    ],
    [0, amp * curl * 0.7 * Math.sin(s.wag - 0.7) * aw + ty1 * sw, 0],
    [0, amp * curl * 0.5 * Math.sin(s.wag - 1.4) * aw + ty2 * sw, 0],
  ]

  // Sprung ears: they swing when the head turns and bounce when running
  s.twitchT -= dt
  if (s.twitchT <= 0) {
    s.twitchT = 3 + random() * 5
    s.twitch = 0.25
    s.twitchSide = random() < 0.5 ? 0 : 1
  }
  s.twitch = Math.max(0, s.twitch - dt)
  const ears = rig.earSides.map((side, i) => {
    const st = s.ears[i]!
    const tw = s.twitch > 0 && s.twitchSide === i ? Math.sin((s.twitch / 0.25) * Math.PI) : 0
    if (rig.ear === 'floppy') {
      const tgt =
        s.perk * 0.14 + (petHead ? 0.06 : 0) + tw * 0.08 + body.k * 0.08 + Math.abs(shakeRoll) * 0.5
      // The base follows the head with some lag; the tip trails, folds and settles back
      st.v += ((tgt - st.a) * 70 - st.v * 9 - side * yawAcc * 0.004 - M.bobAcc * 0.003) * dt
      st.a += st.v * dt
      st.tv +=
        ((0 - st.ta) * 45 - st.tv * 5 - st.v * 0.9 - side * yawAcc * 0.005 - M.bobAcc * 0.006) * dt
      st.ta += st.tv * dt
      st.ta = clamp(st.ta, -0.6, 0.6)
      return {
        base: [
          -s.perk * 0.06 + br * 0.006 - body.k * 0.1 - 0.35 * s.earsBack,
          0,
          side * st.a,
        ] as Rot,
        tip: [-body.k * 0.15 - Math.abs(st.ta) * 0.3, 0, side * st.ta] as Rot,
      }
    }
    const up = petHead ? -0.6 : s.perk * 0.12 + tw * 0.2 - body.k * 0.35
    const tgt = up + (-0.6 - up) * s.earsBack
    st.v += ((tgt - st.a) * 120 - st.v * 11 - side * yawAcc * 0.004) * dt
    st.a += st.v * dt
    return { base: [st.a, 0, side * (petHead ? 0.18 : 0)] as Rot, tip: [0, 0, 0] as Rot }
  })

  // Mouth and tongue: pants with the mouth open and closes it on the ball
  const tongue =
    fetch.holding || eating ? 0 : sm(0.3, 0.8, s.pant) * (0.88 + 0.12 * Math.sin(s.breath))
  // Yawn: opens wide slowly, shuts the eyes and comes back; waiting for the ball it chatters
  s.yawnT = Math.max(0, s.yawnT - dt)
  const yawn = s.yawnT > 0 ? Math.sin((1 - s.yawnT / YAWN) * Math.PI) ** 2 : 0
  s.yawnEyes = yawn * 0.85
  const chatter = task === 'wait' ? 0.04 * Math.max(0, Math.sin(t * 7)) : 0
  const jawT = eating
    ? (CHEW / 2) * (1 - Math.cos(t * 2 * Math.PI * CHEW_HZ))
    : fetch.holding || task === 'grab'
      ? 0.12
      : Math.max(s.pant * (0.04 + 0.01 * br), yawn * 0.2, chatter)
  // Chewing is quick: the jaw follows it closely
  s.jaw = damp(s.jaw, jawT, eating ? 60 : 10, dt)

  return {
    target,
    zone,
    neck,
    head,
    spine,
    spineDy: body.y * (1 - fk) + M.poseY * fk,
    chestDy: br * (0.0035 - s.pant * 0.0015),
    pelvis,
    scratch: s.scratch,
    tail,
    ears,
    jaw: s.jaw,
    tongue,
    lid,
    lowLid,
    sacc: s.sacc,
    dig: s.dig,
    digLegs: s.digLegs,
  }
}

export type HintKey =
  | ZoneId
  | 'idle'
  | 'scratch'
  | 'sit'
  | 'lie'
  | 'sleep'
  | 'belly-up'
  | 'wait'
  | 'chase'
  | 'bringing'
  | 'done'

/** The hint to show this frame; keeps `prev` when nothing new is going on. */
export function pickHint(
  prev: HintKey,
  p: {
    fetch: FetchState
    motion: MotionState
    zone: ZoneId | null
    scratch: number
    sincePet: number
  },
): HintKey {
  const task = p.fetch.task,
    pose = p.motion.pose
  if (task === 'wait') return 'wait'
  // Rolling and digging in the mud are its own doing, not a pose to explain
  if (pose !== 'stand' && pose !== 'roll' && pose !== 'dig' && !p.zone)
    return pose === 'belly' ? 'belly-up' : pose
  if (task === 'chase' || task === 'grab' || task === 'pursue') return 'chase'
  if (task === 'return' || (task === 'present' && p.fetch.holding)) return 'bringing'
  if (task === 'present') return 'done'
  if (p.zone === 'back' && p.scratch > 0.5) return 'scratch'
  if (p.zone) return p.zone
  if (p.sincePet > 2.5 && prev !== 'done') return 'idle'
  return prev
}
