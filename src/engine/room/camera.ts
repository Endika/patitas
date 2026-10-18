import * as THREE from 'three'
import { clamp, type Vec3 } from '@/engine/math'

export interface FixedCamera {
  az: number
  el: number
  /** Vertical field of view in degrees. */
  fov: number
  target: Vec3
  dist: number
  /** Tangent of the half horizontal field of view. */
  tanH: number
}

/** The play area: the floor in view, as depth (away from the camera) from the target. */
export const PLAY = { near: -0.55, far: 1.7 } as const

export function createCamera(): FixedCamera {
  return {
    az: 0.4,
    el: 0.24,
    fov: 30,
    target: new THREE.Vector3(0, 0.3, 0.1),
    dist: 2.4,
    tanH: 0.3,
  }
}

/** Backs the camera off so the floor fits the screen's aspect ratio. */
export function fitCamera(cam: FixedCamera, aspect: number): FixedCamera {
  const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
  cam.dist = Math.max(1.05 / t, 0.85 / (t * aspect))
  cam.tanH = t * aspect
  return cam
}

export function cameraPosition(cam: FixedCamera, out: Vec3 = new THREE.Vector3()): Vec3 {
  const { az, el, dist, target } = cam
  return out.set(
    target.x + dist * Math.sin(az) * Math.cos(el),
    target.y + dist * Math.sin(el),
    target.z + dist * Math.cos(az) * Math.cos(el),
  )
}

export interface PlayAxes {
  /** Unit floor direction from the camera towards the target. */
  fx: number
  fz: number
  /** Floor distance from the camera to the target. */
  camD: number
}

export function playAxes(cam: FixedCamera): PlayAxes {
  const l = cam.dist * Math.cos(cam.el)
  return { fx: -Math.sin(cam.az), fz: -Math.cos(cam.az), camD: l }
}

export interface PlayPoint {
  d: number
  /** Positive to the right of the screen. */
  side: number
  /** Half width of the play area at depth `d`. */
  half: number
  fx: number
  fz: number
}

const halfAt = (camD: number, d: number, tanH: number) =>
  Math.max(0.2, (camD + d) * tanH * 0.8 - 0.18)

export function playLocal(cam: FixedCamera, x: number, z: number): PlayPoint {
  const { fx, fz, camD } = playAxes(cam),
    rx = x - cam.target.x,
    rz = z - cam.target.z
  const d = rx * fx + rz * fz,
    side = rx * -fz + rz * fx
  return { d, side, half: halfAt(camD, d, cam.tanH), fx, fz }
}

export function clampPlay(cam: FixedCamera, x: number, z: number): [number, number] {
  const q = playLocal(cam, x, z)
  const d = clamp(q.d, PLAY.near, PLAY.far)
  const half = halfAt(playAxes(cam).camD, d, cam.tanH)
  const side = clamp(q.side, -half, half)
  return [cam.target.x + q.fx * d - q.fz * side, cam.target.z + q.fz * d + q.fx * side]
}
