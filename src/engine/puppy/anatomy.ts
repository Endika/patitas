import * as THREE from 'three'
import type { Breed } from '@/domain/breeds'
import type { PartTag, Prim, RoundConePrim } from './sdf'

/** A point or direction in the puppy's rest frame: x to its left, y up, z towards the snout. */
export type Tuple3 = [number, number, number]

export interface Bone {
  name: string
  pos: Tuple3
  parent: string | null
}

export interface EyeBall {
  c: Tuple3
  dir: Tuple3
}

export interface Ear {
  nm: string
  s: number
  root: Tuple3
  /** Second ear bone, only on floppy ears. */
  tip?: string
}

/** Where a caress lands; `belly` only counts while the puppy lies down. */
export type ZoneId = 'head' | 'ears' | 'muzzle' | 'chest' | 'back' | 'belly'

export interface Zone {
  zone: ZoneId
  b: string
  c: Tuple3
  r: number
}

export interface MouthInfo {
  mY: number
  mStart: number
  mEnd: number
  hinge: Tuple3
}

export interface Anatomy {
  prims: Prim[]
  bones: Bone[]
  bi: Record<string, number>
  sy: number
  hY: number
  hZ: number
  eyes: Tuple3[]
  eyeBalls: EyeBall[]
  eyeR: number
  nose: { c: Tuple3; rad: Tuple3 }
  /** Where a collar goes round the neck: its middle, the way the neck runs there and its radius. */
  collar: { at: Tuple3; axis: Tuple3; r: number }
  mouthInfo: MouthInfo
  tongue: Tuple3
  zones: Zone[]
  ears: Ear[]
  look: Tuple3
  /** Average fur colour around the eyes; filled in by buildPuppyGeometry. */
  lidColor: THREE.Color
}

interface PrimOpts {
  b: string
  k?: number
  tag?: PartTag
  sub?: boolean
}

/** How far up the neck, from the shoulders to the head, the collar sits. */
const COLLAR_AT = 0.4

export function anatomy(breed: Breed): Anatomy {
  const B = breed.shape
  const P: Prim[] = [],
    bones: Bone[] = [],
    bi: Record<string, number> = {}
  const bone = (name: string, pos: Tuple3, parent: string | null) => {
    bi[name] = bones.length
    bones.push({ name, pos, parent })
  }
  const opts = (o: PrimOpts) => {
    const b = bi[o.b]
    if (b === undefined) throw new Error(`unknown bone "${o.b}"`)
    return { b, k: o.k ?? 0.04, tag: o.tag, sub: !!o.sub }
  }
  const S = (c: Tuple3, r: number, o: PrimOpts) =>
    P.push({ t: 0, cx: c[0], cy: c[1], cz: c[2], r, ...opts(o) })
  const E = (c: Tuple3, rad: Tuple3, rot: Tuple3, o: PrimOpts) => {
    const e = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(rot[0], rot[1], rot[2]),
    ).elements
    P.push({
      t: 1,
      cx: c[0],
      cy: c[1],
      cz: c[2],
      r00: e[0]!,
      r01: e[1]!,
      r02: e[2]!,
      r10: e[4]!,
      r11: e[5]!,
      r12: e[6]!,
      r20: e[8]!,
      r21: e[9]!,
      r22: e[10]!,
      rx: rad[0],
      ry: rad[1],
      rz: rad[2],
      ...opts(o),
    })
  }
  const R = (
    a: Tuple3,
    b: Tuple3,
    ra: number,
    rb: number,
    o: PrimOpts,
    flat?: { n: Tuple3; f: number },
  ) => {
    const bax = b[0] - a[0],
      bay = b[1] - a[1],
      baz = b[2] - a[2]
    const l2 = bax * bax + bay * bay + baz * baz,
      rr = ra - rb
    const p: RoundConePrim = {
      t: 2,
      ax: a[0],
      ay: a[1],
      az: a[2],
      bax,
      bay,
      baz,
      l2,
      rr,
      a2: l2 - rr * rr,
      il2: 1 / l2,
      ra,
      rb,
      f: 0,
      nx: 0,
      ny: 0,
      nz: 0,
      ...opts(o),
    }
    if (flat) {
      const n = new THREE.Vector3(...flat.n).normalize()
      Object.assign(p, { nx: n.x, ny: n.y, nz: n.z, f: flat.f })
    }
    P.push(p)
  }

  // Puppy proportions: big head, short snout, short thick legs, compact body
  const bd = B.body,
    hd = B.head * 1.2,
    L = B.leg * 0.82
  const sy = 0.25 + 0.2 * L
  const hY = sy + 0.33,
    hZ = 0.33
  const rH: Tuple3 = [0.165 * hd, 0.155 * hd, 0.162 * hd]

  // The spine is the body root so the hip wiggle moves only the rump, not the whole dog
  bone('root', [0, 0, 0], null)
  bone('spine', [0, sy + 0.03, 0], 'root')
  bone('pelvis', [0, sy + 0.02, -0.13], 'spine')
  bone('chest', [0, sy + 0.04, 0.15], 'spine')
  bone('neck', [0, sy + 0.12, 0.21], 'chest')
  bone('head', [0, hY - 0.03, hZ - 0.06], 'neck')

  S([0, sy + 0.04, 0.13], 0.17 * bd, { b: 'chest', tag: 'body' })
  S([0, sy + 0.02, -0.15], 0.16 * bd, { b: 'pelvis', tag: 'body', k: 0.06 })
  R([0, sy + 0.02, -0.14], [0, sy + 0.04, 0.12], 0.155 * bd, 0.165 * bd, {
    b: 'spine',
    tag: 'body',
    k: 0.06,
  })
  E([0, sy - 0.03, -0.01], [0.155 * bd, 0.135 * bd, 0.17], [0, 0, 0], {
    b: 'spine',
    tag: 'body',
    k: 0.08,
  })
  const neckA: Tuple3 = [0, sy + 0.08, 0.17],
    neckB: Tuple3 = [0, hY - 0.08, hZ - 0.06]
  R(neckA, neckB, 0.13, 0.12, { b: 'neck', tag: 'neck', k: 0.06 })
  const along = new THREE.Vector3(...neckB).sub(new THREE.Vector3(...neckA))
  const collar = {
    at: neckA.map((a, i) => a + COLLAR_AT * (neckB[i]! - a)) as Tuple3,
    axis: along.normalize().toArray() as Tuple3,
    r: 0.13 + COLLAR_AT * (0.12 - 0.13),
  }
  E([0, hY, hZ], rH, [0, 0, 0], { b: 'head', tag: 'head', k: 0.05 })
  for (const s of [1, -1])
    S([s * 0.075 * hd, hY - 0.06 * hd, hZ + 0.06 * hd], 0.095 * hd, {
      b: 'head',
      tag: 'cheek',
      k: 0.04,
    })
  const m0: Tuple3 = [0, hY - 0.055 * hd, hZ + 0.11 * hd],
    m1: Tuple3 = [0, hY - 0.068 * hd, hZ + 0.11 * hd + 0.075 * B.snout]
  const mra = 0.08 * B.snoutW,
    mrb = 0.068 * B.snoutW
  R(m0, m1, mra, mrb, { b: 'head', tag: 'muzzle', k: 0.05 })
  // The jaw has its own bone: it drops the chin slightly when panting; the mouth stays closed
  const mY = m1[1] - mrb * 0.55,
    mStart = hZ + 0.06 * hd,
    mEnd = m1[2] + mrb + 0.01
  const hinge: Tuple3 = [0, mY, hZ + 0.03 * hd]
  bone('jaw', hinge, 'head')
  S([0, hY - 0.105 * hd, hZ + 0.1 * hd + 0.035 * B.snout], 0.055, {
    b: 'head',
    tag: 'muzzle',
    k: 0.04,
  })

  const ears: Ear[] = []
  for (const s of [1, -1]) {
    const nm = s > 0 ? 'earL' : 'earR'
    if (B.ear === 'floppy') {
      const root: Tuple3 = [s * 0.11 * hd, hY + 0.115 * hd, hZ - 0.03]
      bone(nm, root, 'head')
      // The ear grows from a line along the side of the skull, not from a point
      S(root, 0.036, { b: 'head', tag: 'head', k: 0.03 })
      E(
        [s * 0.135 * hd, root[1] - 0.012, hZ - 0.02],
        [0.028, 0.034, 0.075 * B.earW],
        [0, 0, s * 0.35],
        { b: 'head', tag: 'head', k: 0.045 },
      )
      const top: Tuple3 = [s * 0.13 * hd, root[1] + 0.005, hZ - 0.02],
        end: Tuple3 = [s * 0.19 * hd, root[1] - B.earLen * 1.05, hZ]
      const mid: Tuple3 = [
          top[0] + (end[0] - top[0]) * 0.45,
          top[1] + (end[1] - top[1]) * 0.45,
          top[2] + (end[2] - top[2]) * 0.45,
        ],
        ra = 0.05 * B.earW,
        rb = 0.06 * B.earW,
        rm = (ra + rb) / 2
      const flat = { n: [s, 0.25, 0] as Tuple3, f: 0.32 }
      bone(nm + 'T', mid, nm)
      R(top, mid, ra, rm, { b: nm, tag: 'ear', k: 0.05 }, flat)
      R(mid, end, rm, rb, { b: nm + 'T', tag: 'ear', k: 0.02 }, flat)
      ears.push({ nm, s, root, tip: nm + 'T' })
    } else {
      const base: Tuple3 = [s * 0.085 * hd, hY + 0.12 * hd, hZ - 0.035]
      bone(nm, base, 'head')
      R(
        base,
        [s * 0.135 * hd, base[1] + B.earLen, hZ - 0.005],
        0.055,
        0.01,
        { b: nm, tag: 'ear', k: 0.03 },
        { n: [0, -0.15, 1], f: 0.38 },
      )
      ears.push({ nm, s, root: base })
    }
  }

  for (const s of [1, -1]) {
    const x = s * 0.092 * bd,
      side = s > 0 ? 'L' : 'R'
    const Sh: Tuple3 = [x, sy - 0.04, 0.17],
      El: Tuple3 = [x, 0.11 + 0.1 * L, 0.16],
      Wr: Tuple3 = [x, 0.07, 0.19]
    bone('sh' + side, Sh, 'chest')
    bone('el' + side, El, 'sh' + side)
    bone('wr' + side, Wr, 'el' + side)
    R(Sh, El, 0.074, 0.058, { b: 'sh' + side, tag: 'leg', k: 0.05 })
    R(El, Wr, 0.054, 0.05, { b: 'el' + side, tag: 'leg', k: 0.03 })
    E([x, 0.045, 0.225], [0.063, 0.047, 0.078], [0, 0, 0], { b: 'wr' + side, tag: 'paw', k: 0.03 })
  }
  for (const s of [1, -1]) {
    const x = s * 0.1 * bd,
      side = s > 0 ? 'L' : 'R'
    const Hp: Tuple3 = [x, sy - 0.02, -0.15],
      K: Tuple3 = [x, 0.12 + 0.11 * L, -0.08],
      Hk: Tuple3 = [x, 0.11, -0.19],
      A: Tuple3 = [x, 0.06, -0.17]
    bone('hip' + side, Hp, 'pelvis')
    bone('knee' + side, K, 'hip' + side)
    bone('hock' + side, Hk, 'knee' + side)
    R(Hp, K, 0.105 * bd, 0.064, { b: 'hip' + side, tag: 'leg', k: 0.06 })
    R(K, Hk, 0.054, 0.045, { b: 'knee' + side, tag: 'leg', k: 0.03 })
    R(Hk, A, 0.045, 0.045, { b: 'hock' + side, tag: 'leg', k: 0.02 })
    E([x, 0.045, -0.14], [0.06, 0.045, 0.072], [0, 0, 0], { b: 'hock' + side, tag: 'paw', k: 0.03 })
  }

  // Short puppy tail, born at the end of the rump and standing clear of the back
  const tl = B.tailLen,
    t0: Tuple3 = [0, sy + 0.05, -0.28]
  let t1: Tuple3, t2: Tuple3, t3: Tuple3, tr: [number, number, number, number]
  if (B.tail === 'curl') {
    t1 = [0, sy + 0.17, -0.36]
    t2 = [0.02, sy + 0.23, -0.26]
    t3 = [0.06, sy + 0.18, -0.19]
    tr = [0.065, 0.062, 0.052, 0.036]
  } else {
    t1 = [0, sy + 0.1, -0.39]
    t2 = [0, sy + 0.17 * tl, -0.45]
    t3 = [0, sy + 0.23 * tl, -0.47]
    tr = [0.04, 0.034, 0.027, 0.018]
  }
  bone('tail0', t0, 'pelvis')
  bone('tail1', t1, 'tail0')
  bone('tail2', t2, 'tail1')
  R(t0, t1, tr[0], tr[1], { b: 'tail0', tag: 'tail', k: 0.018 })
  R(t1, t2, tr[1], tr[2], { b: 'tail1', tag: 'tail', k: 0.02 })
  R(t2, t3, tr[2], tr[3], { b: 'tail2', tag: 'tailtip', k: 0.02 })

  // Eyes: big, rounded, the outer corner slightly drooping for the puppy-dog look
  const eyeS = B.eye * 1.12,
    eyeR = 0.031 * eyeS,
    ex = 0.078 * hd,
    ey = hY + 0.005 * hd
  const ez =
    hZ + rH[2] * Math.sqrt(Math.max(0, 1 - (ex / rH[0]) ** 2 - ((ey - hY) / rH[1]) ** 2)) - 0.004
  const eyes: Tuple3[] = [],
    eyeBalls: EyeBall[] = []
  for (const s of [1, -1]) {
    const c: Tuple3 = [s * ex, ey, ez]
    const dir = new THREE.Vector3(s * 0.25, 0.04, 1).normalize()
    E(c, [0.028 * eyeS, 0.024 * eyeS, 0.024 * eyeS], [0, s * 0.22, -s * 0.12], {
      b: 'head',
      k: 0.008,
      sub: true,
    })
    eyes.push(c)
    const sink = 0.016 * eyeS
    eyeBalls.push({
      c: [c[0] - dir.x * sink, c[1] - dir.y * sink, c[2] - dir.z * sink],
      dir: [dir.x, dir.y, dir.z],
    })
  }

  const tipZ = m1[2] + mrb
  const nose = {
    c: [0, m1[1] + 0.02, tipZ - 0.012] as Tuple3,
    rad: [0.034 * B.snoutW, 0.025 * B.snoutW, 0.024] as Tuple3,
  }
  const tongue: Tuple3 = [0, mY, mEnd]
  const mouthInfo: MouthInfo = { mY, mStart, mEnd, hinge }

  const zones: Zone[] = [
    { zone: 'head', b: 'head', c: [0, hY + 0.04, hZ], r: 0.2 },
    { zone: 'muzzle', b: 'head', c: [0, hY - 0.09 * hd, hZ + 0.17 * hd], r: 0.09 },
    { zone: 'chest', b: 'chest', c: [0, sy - 0.02, 0.22], r: 0.14 },
    { zone: 'back', b: 'spine', c: [0, sy + 0.04, 0.0], r: 0.18 },
    { zone: 'back', b: 'pelvis', c: [0, sy + 0.02, -0.16], r: 0.16 },
    { zone: 'belly', b: 'spine', c: [0, sy - 0.12, -0.01], r: 0.13 },
    ...ears.map((e): Zone => ({
      zone: 'ears',
      b: e.nm,
      c:
        B.ear === 'floppy'
          ? [e.s * 0.18, e.root[1] - B.earLen * 0.5, hZ]
          : [e.s * 0.11, e.root[1] + B.earLen * 0.5, hZ - 0.02],
      r: 0.07,
    })),
  ]

  return {
    prims: P,
    bones,
    bi,
    sy,
    hY,
    hZ,
    eyes,
    eyeBalls,
    eyeR,
    nose,
    collar,
    mouthInfo,
    tongue,
    zones,
    ears,
    look: [0, hY + 0.02, hZ + 0.1],
    lidColor: new THREE.Color(0, 0, 0),
  }
}
