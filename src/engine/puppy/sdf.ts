export type PartTag =
  'body' | 'neck' | 'head' | 'cheek' | 'muzzle' | 'ear' | 'leg' | 'paw' | 'tail' | 'tailtip'

interface PrimBase {
  /** Index of the bone this primitive is skinned to. */
  b: number
  /** Smooth-union (or subtraction) blend radius. */
  k: number
  /** Body part, absent on subtractive primitives such as the eye sockets. */
  tag?: PartTag
  sub: boolean
}

export interface SpherePrim extends PrimBase {
  t: 0
  cx: number
  cy: number
  cz: number
  r: number
}

/** Ellipsoid with a row-major rotation matrix into its local frame. */
export interface EllipsoidPrim extends PrimBase {
  t: 1
  cx: number
  cy: number
  cz: number
  r00: number
  r01: number
  r02: number
  r10: number
  r11: number
  r12: number
  r20: number
  r21: number
  r22: number
  rx: number
  ry: number
  rz: number
}

/** Round cone from a to a+ba; when f > 0 it is squashed by f along the unit normal n. */
export interface RoundConePrim extends PrimBase {
  t: 2
  ax: number
  ay: number
  az: number
  bax: number
  bay: number
  baz: number
  l2: number
  rr: number
  a2: number
  il2: number
  ra: number
  rb: number
  f: number
  nx: number
  ny: number
  nz: number
}

export type Prim = SpherePrim | EllipsoidPrim | RoundConePrim

export const sm = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export function roundCone(p: RoundConePrim, x: number, y: number, z: number): number {
  const pax = x - p.ax,
    pay = y - p.ay,
    paz = z - p.az
  const yv = pax * p.bax + pay * p.bay + paz * p.baz
  const zv = yv - p.l2
  const qx = pax * p.l2 - p.bax * yv,
    qy = pay * p.l2 - p.bay * yv,
    qz = paz * p.l2 - p.baz * yv
  const x2 = qx * qx + qy * qy + qz * qz
  const y2 = yv * yv * p.l2,
    z2 = zv * zv * p.l2
  const k = Math.sign(p.rr) * p.rr * p.rr * x2
  if (Math.sign(zv) * p.a2 * z2 > k) return Math.sqrt(x2 + z2) * p.il2 - p.rb
  if (Math.sign(yv) * p.a2 * y2 < k) return Math.sqrt(x2 + y2) * p.il2 - p.ra
  return (Math.sqrt(x2 * p.a2 * p.il2) + yv * p.rr) * p.il2 - p.ra
}

export function primDist(p: Prim, x: number, y: number, z: number): number {
  if (p.t === 0) {
    const dx = x - p.cx,
      dy = y - p.cy,
      dz = z - p.cz
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r
  }
  if (p.t === 1) {
    const dx = x - p.cx,
      dy = y - p.cy,
      dz = z - p.cz
    const lx = p.r00 * dx + p.r01 * dy + p.r02 * dz
    const ly = p.r10 * dx + p.r11 * dy + p.r12 * dz
    const lz = p.r20 * dx + p.r21 * dy + p.r22 * dz
    const ax = lx / p.rx,
      ay = ly / p.ry,
      az = lz / p.rz
    const bx = ax / p.rx,
      by = ay / p.ry,
      bz = az / p.rz
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az),
      k1 = Math.sqrt(bx * bx + by * by + bz * bz)
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(p.rx, p.ry, p.rz)
  }
  if (p.f) {
    const s = ((x - p.ax) * p.nx + (y - p.ay) * p.ny + (z - p.az) * p.nz) * (1 / p.f - 1)
    return roundCone(p, x + p.nx * s, y + p.ny * s, z + p.nz * s) * p.f
  }
  return roundCone(p, x, y, z)
}

export function field(prims: Prim[], x: number, y: number, z: number): number {
  let d = 1e9
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i]!,
      di = primDist(p, x, y, z)
    d = p.sub ? -smin(-d, di, p.k) : smin(d, di, p.k)
  }
  return d
}
