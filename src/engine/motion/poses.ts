import { damp, MAX_DT } from '@/engine/math'
import type { MotionState } from './locomotion'

/** `roll` and `dig` are what it does in the puddle: on its side wriggling, and scraping at the mud. */
export type PoseId = 'stand' | 'sit' | 'lie' | 'belly' | 'sleep' | 'roll' | 'dig'

export interface PoseDef {
  y: number
  /** Upper, middle and paw bone X rotations. */
  front: [number, number, number]
  hind: [number, number, number]
  spread: number
}

type Lying = 'lie' | 'belly' | 'sleep' | 'roll'

const LIE: PoseDef = {
  y: -0.24,
  front: [-1.25, -0.25, 0.35],
  hind: [-1.35, 2.1, -0.9],
  spread: 0,
}

/**
 * `sleep` rests on the bed's cushion on the same legs; behaviour curls the head and tail round.
 * `roll` folds the legs in to kick them about while behaviour turns it onto its side.
 */
export const POSES: Record<Lying, PoseDef> = {
  lie: LIE,
  belly: { y: -0.2, front: [-0.6, 0.3, 1.2], hind: [-0.9, 1.4, -0.6], spread: 0.35 },
  sleep: { ...LIE, y: -0.2 },
  roll: { y: -0.2, front: [-0.8, 0.6, 1], hind: [-0.8, 1.3, -0.5], spread: 0.25 },
}

export const POSE_TIME: Record<'sit' | 'lie' | 'belly' | 'roll' | 'dig', number> = {
  sit: 5,
  lie: 7,
  belly: 6,
  roll: 2,
  dig: 1.5,
}

export interface PoseStep {
  pose: PoseId
  dur: number
}

const poseDef = (p: PoseId): PoseDef | undefined =>
  p === 'stand' || p === 'sit' || p === 'dig' ? undefined : POSES[p]

/** Without `dur`, a trick lasts its POSE_TIME and sleep lasts until something stands it up. */
export function setPose(
  m: MotionState,
  p: PoseId,
  dur = p === 'stand' ? 0 : p === 'sleep' ? Infinity : POSE_TIME[p],
  then: PoseStep | null = null,
): void {
  m.pose = p
  m.poseT = 0
  m.poseDur = dur
  m.then = then
  if (p !== 'stand') m.goal = null
}

/** Advances the pose timer and blends the lying leg pose; sets `sitGoal` while sitting. */
export function stepPoses(m: MotionState, dt: number): void {
  dt = Math.min(dt, MAX_DT)
  m.poseT += dt
  if (m.pose !== 'stand' && m.poseT > m.poseDur) {
    if (m.then) setPose(m, m.then.pose, m.then.dur)
    else setPose(m, 'stand')
  }
  const P = poseDef(m.pose)
  m.fk = damp(m.fk, P ? 1 : 0, P ? 4 : 3, dt)
  m.bellyW = damp(m.bellyW, m.pose === 'belly' ? 1 : 0, 2.5, dt)
  m.rollW = damp(m.rollW, m.pose === 'roll' ? 1 : 0, 4, dt)
  m.sleepW = damp(m.sleepW, m.pose === 'sleep' ? 1 : 0, 2, dt)
  if (P) {
    m.poseY = damp(m.poseY, P.y, 6, dt)
    m.spread = damp(m.spread, P.spread, 5, dt)
    m.legPose.forEach((lp, i) =>
      (i < 2 ? P.front : P.hind).forEach((v, j) => {
        lp[j] = damp(lp[j]!, v, 6, dt)
      }),
    )
  }
  if (m.pose === 'sit') m.sitGoal = 1
}
