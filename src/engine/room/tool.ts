import * as THREE from 'three'
import type { Vec3 } from '@/engine/math'

/** Where a tool in hand is held from the spot it works on: back towards the camera, aside and up. */
export interface Grip {
  back: number
  side: number
  up: number
}

const Z = new THREE.Vector3(0, 0, 1),
  UP = new THREE.Vector3(0, 1, 0)
const view = new THREE.Vector3(),
  side = new THREE.Vector3()

/**
 * Puts `tool` by `at` as `grip` says, its +z pointing at the spot: held off to one side, it shows
 * side on rather than end on.
 */
export function holdTool(tool: THREE.Object3D, at: Vec3, camera: Vec3, grip: Grip): void {
  const d = view.copy(at).sub(camera).normalize()
  side.crossVectors(d, UP).normalize()
  tool.position
    .copy(at)
    .addScaledVector(d, -grip.back)
    .addScaledVector(side, grip.side)
    .addScaledVector(UP, grip.up)
  tool.quaternion.setFromUnitVectors(Z, d.copy(at).sub(tool.position).normalize())
}

/** Frees every geometry and material under `root`, each once however many meshes share it. */
export function disposeTree(root: THREE.Object3D): void {
  const done = new Set<THREE.Material | THREE.BufferGeometry>()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    for (const r of [o.geometry, o.material] as (THREE.Material | THREE.BufferGeometry)[]) {
      if (done.has(r)) continue
      done.add(r)
      r.dispose()
    }
  })
}
