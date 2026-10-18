import * as THREE from 'three'
import { clamp, damp, MAX_DT, type Vec3 } from '@/engine/math'
import { GAITS, type GaitId } from './gaits'
import type { LegRig } from './ik'
import { setPose, type PoseId, type PoseStep } from './poses'

export interface MotionState {
  pos: Vec3
  heading: number
  yawRate: number
  speed: number
  goal: Vec3 | null
  /** Heading to turn to on the spot once there is no goal. */
  face: number | null
  gait: GaitId
  /** Gait to switch to at the start of the next cycle. */
  next: GaitId
  phase: number
  active: boolean
  bob: number
  bobV: number
  bobAcc: number
  sit: number
  bow: number
  /** Set by the caller each frame (stepPoses sets it while sitting). */
  sitGoal: number
  bowGoal: number
  pose: PoseId
  poseT: number
  poseDur: number
  then: PoseStep | null
  fk: number
  bellyW: number
  poseY: number
  /** Blended [upper, middle, paw] rotations per leg for the lying poses. */
  legPose: [number, number, number][]
  spread: number
}

/** A leg's footfall; positions are in world space. */
export interface LegState {
  rig: LegRig
  planted: Vec3
  from: Vec3
  land: Vec3
  pos: Vec3
  swinging: boolean
  s: number
}

export interface BodyPose {
  y: number
  pitch: number
  roll: number
  k: number
}

export function createMotionState(): MotionState {
  return {
    pos: new THREE.Vector3(),
    heading: 0,
    yawRate: 0,
    speed: 0,
    goal: null,
    face: null,
    gait: 'walk',
    next: 'walk',
    phase: 0,
    active: false,
    bob: 0,
    bobV: 0,
    bobAcc: 0,
    sit: 0,
    bow: 0,
    sitGoal: 0,
    bowGoal: 0,
    pose: 'stand',
    poseT: 0,
    poseDur: 0,
    then: null,
    fk: 0,
    bellyW: 0,
    poseY: 0,
    legPose: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    spread: 0,
  }
}

/** World position of the leg's paw at rest for a body at `pos` facing `h`. */
export function restWorld(L: LegRig, out: Vec3, pos: Vec3, h: number): Vec3 {
  const c = Math.cos(h),
    s = Math.sin(h)
  return out.set(pos.x + L.rest.x * c + L.rest.z * s, L.rest.y, pos.z - L.rest.x * s + L.rest.z * c)
}

/** Legs planted at their rest spots under the body. */
export function createLegStates(rigs: LegRig[], m: MotionState): LegState[] {
  return rigs.map((rig) => {
    const planted = restWorld(rig, new THREE.Vector3(), m.pos, m.heading)
    return {
      rig,
      planted,
      from: new THREE.Vector3(),
      land: planted.clone(),
      pos: planted.clone(),
      swinging: false,
      s: 0,
    }
  })
}

export interface GoToOpts {
  happy: number
  energy: number
  gait?: GaitId
  clamp: (x: number, z: number) => [number, number]
  random?: () => number
}

export function goTo(m: MotionState, x: number, z: number, opts: GoToOpts): void {
  ;[x, z] = opts.clamp(x, z)
  m.goal = (m.goal ?? new THREE.Vector3()).set(x, 0, z)
  const dist = Math.hypot(x - m.pos.x, z - m.pos.z)
  const { happy } = opts
  m.next =
    opts.gait ??
    (dist > 0.9
      ? happy > 0.45
        ? 'hop'
        : 'trot'
      : dist > 0.4
        ? happy > 0.6
          ? 'hop'
          : 'trot'
        : 'walk')
  if ((opts.random ?? Math.random)() < opts.energy * 0.5 && m.next === 'trot') m.next = 'hop'
  if (!m.active) m.gait = m.next
  if (m.pose !== 'stand') setPose(m, 'stand')
}

const tmp2 = new THREE.Vector3(),
  tmp3 = new THREE.Vector3()

/**
 * Moves the body towards its goal and steps the legs. The step cycle only runs while the body
 * moves, turns, or a planted foot is more than 0.025 off its rest spot.
 */
export function stepLocomotion(m: MotionState, legs: LegState[], dt: number): BodyPose {
  dt = Math.min(dt, MAX_DT)
  let spdT = 0,
    turnTo = m.face
  if (m.goal) {
    const dx = m.goal.x - m.pos.x,
      dz = m.goal.z - m.pos.z,
      dist = Math.hypot(dx, dz)
    if (dist < 0.04) m.goal = null
    else {
      turnTo = Math.atan2(dx, dz)
      spdT = Math.min(GAITS[m.next].speed, 0.15 + dist * 1.6) * Math.max(0, 1 - m.fk * 1.5)
    }
  }
  let diff = 0
  if (turnTo != null) {
    diff = Math.atan2(Math.sin(turnTo - m.heading), Math.cos(turnTo - m.heading))
    if (!m.goal && Math.abs(diff) < 0.06) m.face = null
  }
  m.yawRate = damp(m.yawRate, clamp(diff * 5, -4, 4), 8, dt)
  m.heading += m.yawRate * dt
  m.speed = damp(m.speed, spdT * Math.max(0.15, Math.cos(diff)), 5, dt)
  m.pos.x += Math.sin(m.heading) * m.speed * dt
  m.pos.z += Math.cos(m.heading) * m.speed * dt

  const offRest = (L: LegState) =>
    restWorld(L.rig, tmp2, m.pos, m.heading).distanceTo(L.planted) > 0.025
  let off = false,
    swinging = false
  for (const L of legs) {
    swinging ||= L.swinging
    if (!L.swinging && offRest(L)) off = true
  }
  m.active = m.speed > 0.03 || Math.abs(m.yawRate) > 0.15 || off || swinging
  if (!m.goal && m.speed < 0.05) m.next = 'walk'
  if (m.active) {
    const g = GAITS[m.gait],
      before = m.phase
    m.phase += dt * g.freq * clamp(m.speed / g.speed, 0.7, 1.25)
    if (Math.floor(m.phase) !== Math.floor(before)) m.gait = m.next
  }
  const g = GAITS[m.gait]
  legs.forEach((L, i) => {
    const lp = (((m.phase + g.off[i]!) % 1) + 1) % 1
    const needStep = () => m.speed > 0.03 || Math.abs(m.yawRate) > 0.15 || offRest(L)
    if (m.active && lp >= g.duty && (L.swinging || needStep())) {
      if (!L.swinging) {
        L.swinging = true
        L.from.copy(L.planted)
      }
      const s = (lp - g.duty) / (1 - g.duty)
      const ahead = ((1 - s) * (1 - g.duty)) / g.freq + g.duty / (2 * g.freq)
      tmp3.set(
        m.pos.x + Math.sin(m.heading) * m.speed * ahead,
        0,
        m.pos.z + Math.cos(m.heading) * m.speed * ahead,
      )
      restWorld(L.rig, L.land, tmp3, m.heading + m.yawRate * ahead)
      L.pos.lerpVectors(L.from, L.land, s * s * (3 - 2 * s))
      L.pos.y = L.rig.rest.y + g.lift * Math.sin(Math.PI * s)
      L.s = s
    } else {
      if (L.swinging) {
        L.swinging = false
        L.planted.copy(L.land)
      }
      L.pos.copy(L.planted)
      L.s = 0
    }
  })

  // Body: bounce, pitch on the hops, lean into turns, sitting and the play bow
  const k = m.active ? clamp(m.speed / g.speed, 0, 1) : 0
  const ph = m.phase * Math.PI * 2
  let bob: number,
    pitch = 0
  if (m.gait === 'hop') {
    bob = 0.05 * Math.max(0, Math.cos(ph - Math.PI * 2 * 0.93)) ** 2 * k
    pitch = -0.14 * Math.sin(ph - Math.PI * 2 * 0.7) * k
  } else bob = (m.gait === 'trot' ? 0.01 : 0.006) * Math.cos(2 * ph) * k
  m.sit = damp(m.sit, m.sitGoal, m.sitGoal > m.sit ? 9 : 4, dt)
  m.bow = damp(m.bow, m.bowGoal, 5, dt)
  const bobVel = (bob - m.bob) / Math.max(dt, 1e-3)
  m.bobAcc = clamp((bobVel - m.bobV) / Math.max(dt, 1e-3), -40, 40)
  m.bob = bob
  m.bobV = bobVel
  return {
    y: bob - 0.07 * m.sit - 0.04 * m.bow,
    pitch: pitch - 0.45 * m.sit + 0.3 * m.bow,
    roll: -m.yawRate * 0.05 * k,
    k,
  }
}
