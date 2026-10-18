import * as THREE from 'three'
import type { Breed } from '@/domain/breeds'
import { anatomy, type Anatomy } from './anatomy'
import { COATS, FUR_BY_TAG, GUM, RIM, paletteColors, type CoatInput } from './coat'
import { fbm, vnoise } from './noise'
import { field, primDist, sm, type PartTag } from './sdf'
import { surfaceNets } from './surfaceNets'

function boneIndex(A: Anatomy, name: string): number {
  const b = A.bi[name]
  if (b === undefined) throw new Error(`unknown bone "${name}"`)
  return b
}

/** Meshes the breed's distance field and bakes skinning, coat colour, AO and fur length. */
export function buildPuppyGeometry(breed: Breed): {
  geometry: THREE.BufferGeometry
  anatomy: Anatomy
} {
  const A = anatomy(breed),
    P = A.prims
  const { position, normal, index: tri } = surfaceNets(P)
  const nv = position.length / 3
  const coat = COATS[breed.coat],
    pal = paletteColors(breed.palette)
  const jaw = boneIndex(A, 'jaw'),
    head = boneIndex(A, 'head')

  // Skin weights, coat, fur length and ambient occlusion
  const nb = A.bones.length,
    adds = P.filter((p) => !p.sub)
  const skinIndex = new Uint16Array(nv * 4),
    skinWeight = new Float32Array(nv * 4)
  const color = new Float32Array(nv * 3),
    furLen = new Float32Array(nv)
  const bw = new Float32Array(nb),
    col = new THREE.Color()
  const ds = new Float64Array(adds.length)
  const info: CoatInput = {
    x: 0,
    y: 0,
    z: 0,
    tag: 'body',
    nx: 0,
    ny: 0,
    nz: 0,
    sy: A.sy,
    hY: A.hY,
    hZ: A.hZ,
    n: 0,
  }
  const lidSum = new THREE.Color(0, 0, 0)
  let lidN = 0
  const mi = A.mouthInfo
  for (let q = 0; q < nv; q++) {
    const x = position[q * 3]!,
      y = position[q * 3 + 1]!,
      z = position[q * 3 + 2]!
    let dmin = Infinity,
      tag: PartTag = 'body'
    for (let i = 0; i < adds.length; i++) {
      const p = adds[i]!,
        d = primDist(p, x, y, z)
      ds[i] = d
      if (d < dmin) {
        dmin = d
        tag = p.tag ?? 'body'
      }
    }
    bw.fill(0)
    adds.forEach((p, i) => {
      bw[p.b]! += Math.exp(-(ds[i]! - dmin) / (p.tag === 'ear' ? 0.006 : 0.015))
    })
    const top = [...bw.keys()].sort((a, b) => bw[b]! - bw[a]!).slice(0, 4)
    const sum = top.reduce((s, b) => s + bw[b]!, 0)
    top.forEach((b, i) => {
      skinIndex[q * 4 + i] = b
      skinWeight[q * 4 + i] = bw[b]! / sum
    })
    const inMouth =
      z > mi.mStart - 0.03 &&
      y < mi.mY + 0.02 &&
      Math.abs(x) < 0.13 &&
      (tag === 'muzzle' || tag === 'cheek' || tag === 'head')
    if (inMouth) {
      const wj = sm(mi.mY + 0.006, mi.mY - 0.006, y) * sm(mi.mStart - 0.02, mi.mStart + 0.03, z)
      skinIndex.set([jaw, head, 0, 0], q * 4)
      skinWeight.set([wj, 1 - wj, 0, 0], q * 4)
    }
    const lip = inMouth
      ? (1 - sm(0.004, 0.01, Math.abs(y - mi.mY))) *
        sm(mi.mEnd - 0.06, mi.mEnd - 0.02, z) *
        sm(0.03, 0.012, Math.abs(x))
      : 0

    info.x = x
    info.y = y
    info.z = z
    info.tag = tag
    info.nx = normal[q * 3]!
    info.ny = normal[q * 3 + 1]!
    info.nz = normal[q * 3 + 2]!
    info.n = fbm(x * 9, y * 9, z * 9)
    coat(info, pal, col)
    const o1 = field(P, x + info.nx * 0.03, y + info.ny * 0.03, z + info.nz * 0.03)
    const o2 = field(P, x + info.nx * 0.08, y + info.ny * 0.08, z + info.nz * 0.08)
    const ao = 0.5 * Math.min(1, Math.max(0, o1 / 0.03)) + 0.5 * Math.min(1, Math.max(0, o2 / 0.08))
    col.multiplyScalar(0.55 + 0.45 * ao)
    for (const ec of A.eyes) {
      const d = Math.hypot(x - ec[0], y - ec[1], z - ec[2])
      if (d > A.eyeR * 1.8 && d < A.eyeR * 2.6) {
        lidSum.r += col.r
        lidSum.g += col.g
        lidSum.b += col.b
        lidN++
      }
      col.lerp(RIM, 0.75 * (1 - sm(A.eyeR * 0.95, A.eyeR * 1.3, d)))
    }
    col.lerp(GUM, lip * 0.8)
    color.set([col.r, col.g, col.b], q * 3)

    let fl = FUR_BY_TAG[tag]
    for (const ec of A.eyes)
      fl *= sm(A.eyeR * 1.25, A.eyeR * 2.1, Math.hypot(x - ec[0], y - ec[1], z - ec[2]))
    fl *= sm(0.035, 0.06, Math.hypot(x - A.nose.c[0], y - A.nose.c[1], z - A.nose.c[2]))
    const nearLip = inMouth ? 1 - 0.6 * lip : 1
    furLen[q] =
      fl * (1 - lip) * (0.25 + 0.75 * nearLip) * (0.85 + 0.3 * vnoise(x * 40, y * 40, z * 40))
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3))
  geometry.setAttribute('furLen', new THREE.BufferAttribute(furLen, 1))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  geometry.setIndex(tri)
  A.lidColor = lidSum.multiplyScalar(1 / Math.max(1, lidN))
  return { geometry, anatomy: A }
}
