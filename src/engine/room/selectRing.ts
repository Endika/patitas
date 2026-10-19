import * as THREE from 'three'
import type { BodyShape } from './bodies'

/** The HUD's accent, so the ring reads as the controls' target. */
const RING_COLOR = 0xe0674f,
  RING_OPACITY = 0.7
/** Its band as a share of its radius, and how far it stands clear of the body. */
const BAND = 0.14,
  MARGIN = 0.06
/** Just over the floor, under the messes. */
const RING_Y = 0.002

/** The ring under the puppy that the care and trick buttons are for. */
export interface SelectRing {
  /** Stands under `at` with radius `r`, or hides with nobody. */
  follow(at: { x: number; z: number } | null, r: number): void
  dispose(): void
}

/** Far enough round the root to take in the chest and the rump of the puppy standing. */
export function ringRadius({ stand }: BodyShape): number {
  return Math.max(stand.chest.z + stand.chest.r, Math.abs(stand.rump.z) + stand.rump.r) + MARGIN
}

export function createSelectRing(scene: THREE.Scene): SelectRing {
  const geometry = new THREE.RingGeometry(1 - BAND, 1, 48).rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    opacity: RING_OPACITY,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.position.y = RING_Y
  ring.visible = false
  scene.add(ring)
  return {
    follow(at, r) {
      ring.visible = !!at
      if (!at) return
      ring.position.x = at.x
      ring.position.z = at.z
      ring.scale.set(r, 1, r)
    },
    dispose() {
      scene.remove(ring)
      geometry.dispose()
      material.dispose()
    },
  }
}
