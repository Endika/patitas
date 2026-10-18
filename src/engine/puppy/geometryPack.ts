import * as THREE from 'three'
import type { Anatomy, Tuple3 } from './anatomy'
import type { PuppyGeometry } from './geometry'

type Numbers = Float32Array | Uint16Array | Uint32Array

interface PackedAttribute {
  name: string
  array: Numbers
  itemSize: number
  normalized: boolean
}

/** A puppy geometry as structured-clone data, for posting between a worker and the page. */
export interface PackedPuppyGeometry {
  attributes: PackedAttribute[]
  index: Numbers | null
  anatomy: Omit<Anatomy, 'lidColor'> & { lidColor: Tuple3 }
}

/** Posting `packed` with `transfer` detaches the geometry's arrays from `g`. */
export function packPuppyGeometry(g: PuppyGeometry): {
  packed: PackedPuppyGeometry
  transfer: ArrayBuffer[]
} {
  const attributes = Object.entries(g.geometry.attributes).map(([name, a]) => ({
    name,
    array: (a as THREE.BufferAttribute).array as Numbers,
    itemSize: a.itemSize,
    normalized: a.normalized,
  }))
  const index = (g.geometry.getIndex()?.array as Numbers | undefined) ?? null
  const { lidColor, ...anatomy } = g.anatomy
  const buffers = new Set<ArrayBuffer>()
  for (const a of [...attributes.map((a) => a.array), ...(index ? [index] : [])])
    buffers.add(a.buffer as ArrayBuffer)
  return {
    packed: {
      attributes,
      index,
      anatomy: { ...anatomy, lidColor: [lidColor.r, lidColor.g, lidColor.b] },
    },
    transfer: [...buffers],
  }
}

export function unpackPuppyGeometry(p: PackedPuppyGeometry): PuppyGeometry {
  const geometry = new THREE.BufferGeometry()
  for (const a of p.attributes)
    geometry.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized))
  if (p.index) geometry.setIndex(new THREE.BufferAttribute(p.index, 1))
  const [r, g, b] = p.anatomy.lidColor
  return { geometry, anatomy: { ...p.anatomy, lidColor: new THREE.Color(r, g, b) } }
}
