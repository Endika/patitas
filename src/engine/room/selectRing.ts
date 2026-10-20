import * as THREE from 'three'
import type { Body, BodyShape } from './bodies'

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
  /** Stands at (x, z) on the floor with radius `r`. */
  follow(x: number, z: number, r: number): void
  hide(): void
  dispose(): void
}

/** Far enough round the middle of the chest and the rump to take in both, the puppy standing. */
export function ringRadius({ stand: { chest, rump } }: BodyShape): number {
  return (chest.z - rump.z) / 2 + Math.max(chest.r, rump.r) + MARGIN
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
    follow(x, z, r) {
      ring.visible = true
      ring.position.x = x
      ring.position.z = z
      ring.scale.set(r, 1, r)
    },
    hide() {
      ring.visible = false
    },
    dispose() {
      scene.remove(ring)
      geometry.dispose()
      material.dispose()
    },
  }
}

/** What the ring needs of a puppy: where its body is, its shape, and whether it is bathed or brushed. */
export interface RingView {
  body: Body
  shape: BodyShape
  bath: { phase: string }
  brush: { on: boolean }
}

/**
 * Puts the ring under the puppy at `chosen`, or hides it: with fewer than two puppies there is
 * nobody to tell apart, bathing and brushing already single one out, and a null or out-of-range
 * index points at no one.
 */
export function syncRing(ring: SelectRing, views: readonly RingView[], chosen: number | null) {
  let busy = false
  for (let i = 0; i < views.length; i++) {
    const w = views[i]!
    busy ||= w.bath.phase !== 'off' || w.brush.on
  }
  const v = chosen === null || views.length < 2 ? undefined : views[chosen]
  if (!v || busy) return ring.hide()
  const { chest, rump } = v.body
  ring.follow((chest.x + rump.x) / 2, (chest.z + rump.z) / 2, ringRadius(v.shape))
}
