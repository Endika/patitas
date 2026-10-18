import { field, type Prim } from './sdf'

export interface SurfaceMesh {
  position: Float32Array
  normal: Float32Array
  index: number[]
}

const OFF = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
] as const
const EDG = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const

/**
 * Surface nets over the puppy's distance field on a fixed grid, with every vertex projected
 * onto the zero level set, gradient normals and triangles wound to face along them.
 */
export function surfaceNets(P: Prim[]): SurfaceMesh {
  const cs = 0.011,
    x0 = -0.37,
    y0 = -0.03,
    z0 = -0.74
  const nx = Math.ceil(0.74 / cs) + 1,
    ny = Math.ceil(1.4 / cs) + 1,
    nz = Math.ceil(1.7 / cs) + 1
  const I = (i: number, j: number, k: number) => i + nx * (j + ny * k)
  const F = new Float32Array(nx * ny * nz)
  // Blocks whose centre is far from the surface are filled with that single sample
  const BS = 4,
    margin = cs * BS * 0.87 * 1.4 + 0.03
  for (let k0 = 0; k0 < nz; k0 += BS)
    for (let j0 = 0; j0 < ny; j0 += BS)
      for (let i0 = 0; i0 < nx; i0 += BS) {
        const dc = field(P, x0 + (i0 + 1.5) * cs, y0 + (j0 + 1.5) * cs, z0 + (k0 + 1.5) * cs)
        const i1 = Math.min(i0 + BS, nx),
          j1 = Math.min(j0 + BS, ny),
          k1 = Math.min(k0 + BS, nz)
        const far = Math.abs(dc) > margin
        for (let k = k0; k < k1; k++)
          for (let j = j0; j < j1; j++)
            for (let i = i0; i < i1; i++) {
              F[I(i, j, k)] = far ? dc : field(P, x0 + i * cs, y0 + j * cs, z0 + k * cs)
            }
      }

  const vid = new Int32Array(nx * ny * nz).fill(-1)
  const pos: number[] = [],
    v = new Float32Array(8)
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const o = OFF[c]!
          v[c] = F[I(i + o[0], j + o[1], k + o[2])]!
          if (v[c]! < 0) mask |= 1 << c
        }
        if (mask === 0 || mask === 255) continue
        let sx = 0,
          sY = 0,
          sz = 0,
          n = 0
        for (const [a, b] of EDG) {
          const va = v[a]!,
            vb = v[b]!
          if (va < 0 === vb < 0) continue
          const t = va / (va - vb)
          const oa = OFF[a],
            ob = OFF[b]
          sx += oa[0] + (ob[0] - oa[0]) * t
          sY += oa[1] + (ob[1] - oa[1]) * t
          sz += oa[2] + (ob[2] - oa[2]) * t
          n++
        }
        vid[I(i, j, k)] = pos.length / 3
        pos.push(x0 + (i + sx / n) * cs, y0 + (j + sY / n) * cs, z0 + (k + sz / n) * cs)
      }
  const tri: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    tri.push(a, b, c, a, c, d)
  }
  const V = (i: number, j: number, k: number) => vid[I(i, j, k)]!
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inA = F[I(i, j, k)]! < 0
        if (F[I(i + 1, j, k)]! < 0 !== inA)
          quad(V(i, j - 1, k - 1), V(i, j, k - 1), V(i, j, k), V(i, j - 1, k))
        if (F[I(i, j + 1, k)]! < 0 !== inA)
          quad(V(i - 1, j, k - 1), V(i, j, k - 1), V(i, j, k), V(i - 1, j, k))
        if (F[I(i, j, k + 1)]! < 0 !== inA)
          quad(V(i - 1, j - 1, k), V(i, j - 1, k), V(i, j, k), V(i - 1, j, k))
      }

  const nv = pos.length / 3
  const position = new Float32Array(pos),
    normal = new Float32Array(nv * 3)
  const e = 0.003
  const grad = (x: number, y: number, z: number, out: number[]) => {
    out[0] = field(P, x + e, y, z) - field(P, x - e, y, z)
    out[1] = field(P, x, y + e, z) - field(P, x, y - e, z)
    out[2] = field(P, x, y, z + e) - field(P, x, y, z - e)
    const l = Math.hypot(out[0], out[1], out[2]) || 1
    out[0] /= l
    out[1] /= l
    out[2] /= l
  }
  const g = [0, 0, 0]
  for (let q = 0; q < nv; q++) {
    let x = position[q * 3]!,
      y = position[q * 3 + 1]!,
      z = position[q * 3 + 2]!
    for (let it = 0; it < 2; it++) {
      const d = field(P, x, y, z)
      grad(x, y, z, g)
      x -= g[0]! * d
      y -= g[1]! * d
      z -= g[2]! * d
    }
    grad(x, y, z, g)
    position.set([x, y, z], q * 3)
    normal.set(g, q * 3)
  }
  const at = (arr: Float32Array, i: number) => arr[i]!
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]! * 3,
      b = tri[t + 1]! * 3,
      c = tri[t + 2]! * 3
    const ux = at(position, b) - at(position, a),
      uy = at(position, b + 1) - at(position, a + 1),
      uz = at(position, b + 2) - at(position, a + 2)
    const wx = at(position, c) - at(position, a),
      wy = at(position, c + 1) - at(position, a + 1),
      wz = at(position, c + 2) - at(position, a + 2)
    const cx = uy * wz - uz * wy,
      cy = uz * wx - ux * wz,
      cz = ux * wy - uy * wx
    const dot =
      cx * (at(normal, a) + at(normal, b) + at(normal, c)) +
      cy * (at(normal, a + 1) + at(normal, b + 1) + at(normal, c + 1)) +
      cz * (at(normal, a + 2) + at(normal, b + 2) + at(normal, c + 2))
    if (dot < 0) {
      const s = tri[t + 1]!
      tri[t + 1] = tri[t + 2]!
      tri[t + 2] = s
    }
  }
  return { position, normal, index: tri }
}
