import * as THREE from 'three'
import { RIM } from './coat'
import { vnoise } from './noise'
import { sm } from './sdf'

const eyeTextures = new Map<string, THREE.CanvasTexture>()

/** Iris in equirectangular projection: the top row is the centre of the pupil. */
export function eyeTexture(iris: [string, string]): THREE.CanvasTexture {
  const key = iris.join()
  const cached = eyeTextures.get(key)
  if (cached) return cached
  const W = 512,
    H = 256,
    cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!,
    img = g.createImageData(W, H)
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const inner = rgb(iris[0]),
    outer = rgb(iris[1]),
    sclera = [218, 206, 190],
    limbus = [34, 22, 14]
  const PUPIL = 0.52,
    IRIS = 1.45
  for (let y = 0; y < H; y++) {
    const th = ((y + 0.5) / H) * Math.PI
    for (let x = 0; x < W; x++) {
      const u = x / W
      let c: number[]
      if (th < IRIS) {
        const t = Math.max(0, (th - PUPIL) / (IRIS - PUPIL))
        const fib =
          0.92 +
          0.08 * Math.sin(u * Math.PI * 140 + 5 * vnoise(u * 24, th * 4, 3)) +
          0.08 * (vnoise(u * 140, th * 16, 7) - 0.5)
        const k = fib * (1 + 0.12 * Math.exp(-((t - 0.2) ** 2) / 0.01)) * (1 - 0.5 * sm(0.7, 1, t))
        const p = 1 - sm(PUPIL - 0.03, PUPIL + 0.02, th)
        c = inner.map((v, i) => (v + (outer[i]! - v) * t) * k * (1 - p) + 6 * p)
      } else {
        const s = sm(IRIS, IRIS + 0.14, th)
        c = limbus.map((v, i) => v + (sclera[i]! - v) * s * (1 - 0.35 * sm(1.6, 2.4, th)))
      }
      const o = (y * W + x) * 4
      img.data[o] = Math.min(255, c[0]!)
      img.data[o + 1] = Math.min(255, c[1]!)
      img.data[o + 2] = Math.min(255, c[2]!)
      img.data[o + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  eyeTextures.set(key, tex)
  return tex
}

/**
 * An eyelid as a half sphere around the eyeball, skin-coloured and darkening to the rim at its
 * edge. The upper and lower lids cross at the corners and leave an almond opening.
 */
export function lidGeometry(r: number, coat: THREE.Color, lower = false): THREE.SphereGeometry {
  const g = lower
    ? new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, Math.PI / 2 - 0.04, Math.PI / 2 + 0.04)
    : new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.04)
  const p = g.attributes.position!,
    c = new Float32Array(p.count * 3),
    tc = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const fromPole = Math.acos(THREE.MathUtils.clamp(p.getY(i) / r, -1, 1))
    tc.copy(coat).lerp(RIM, sm(1.2, 1.5, lower ? Math.PI - fromPole : fromPole))
    c.set([tc.r, tc.g, tc.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

let noseGeo: THREE.SphereGeometry | undefined

/** Dog nose: wider at the top, a central groove, comma-shaped nostrils and rough leather. */
export function noseGeometry(): THREE.SphereGeometry {
  if (noseGeo) return noseGeo
  const g = new THREE.SphereGeometry(1, 72, 54)
  const p = g.attributes.position!,
    col = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i)
    const front = Math.max(0, z)
    let r = 1 + (vnoise(x * 16 + 3, y * 16, z * 16) - 0.5) * 0.05 * front
    const groove = Math.exp(-(x * x) / 0.004) * sm(0.25, -0.5, y) * front
    let nostril = 0
    for (const s of [1, -1]) {
      const dx = (x - s * 0.4) / 0.15,
        dy = (y + 0.05 + 0.25 * Math.abs(x - s * 0.4)) / 0.09
      nostril = Math.max(nostril, Math.exp(-(dx * dx + dy * dy)) * front)
    }
    r *= 1 - 0.22 * nostril - 0.12 * groove
    p.setXYZ(i, x * r * (1 + 0.16 * y), y * r, z * r * (1 - 0.12 * front))
    const shade = (1 - 0.75 * nostril - 0.3 * groove) * (1 + 0.15 * sm(0.2, 0.9, y))
    col.set([shade, shade, shade], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  noseGeo = g
  return g
}

const TNV = 18,
  TNU = 14

/** A tongue with volume: oval section, a central groove and a rounded tip. */
export function makeTongue(material: THREE.Material): THREE.Mesh {
  const n = (TNV + 1) * TNU,
    g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  const col = new Float32Array(n * 3),
    c = new THREE.Color(),
    idx: number[] = []
  for (let v = 0; v <= TNV; v++)
    for (let u = 0; u < TNU; u++) {
      const up = Math.cos((u / TNU) * Math.PI * 2)
      c.set('#d8627a').multiplyScalar((up > 0 ? 1 : 0.78) * (0.95 + 0.08 * (v / TNV)))
      col.set([c.r, c.g, c.b], (v * TNU + u) * 3)
      if (v < TNV) {
        const a = v * TNU + u,
          b = v * TNU + ((u + 1) % TNU)
        idx.push(a, a + TNU, b, b, a + TNU, b + TNU)
      }
    }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(idx)
  return new THREE.Mesh(g, material)
}

/** Bends the tongue out of the mouth by `out` (0..1); it hangs longer and curls more when panting. */
export function shapeTongue(mesh: THREE.Mesh, out: number): void {
  mesh.visible = out > 0.12
  if (!mesh.visible) return
  const p = mesh.geometry.attributes.position!
  const len = 0.02 + 0.07 * out,
    curl = 0.5 + 1.4 * out
  let cy = 0,
    cz = 0,
    a = 0
  for (let v = 0; v <= TNV; v++) {
    const t = v / TNV
    if (v > 0) {
      a = curl * (t - 0.5 / TNV) ** 1.5
      cy -= (Math.sin(a) * len) / TNV
      cz += (Math.cos(a) * len) / TNV
    }
    const tip = Math.sqrt(Math.max(0, 1 - t ** 4))
    const w = 0.026 * (0.85 + 0.15 * Math.min(1, t * 2)) * tip,
      th = 0.0065 * tip + 0.0004
    for (let u = 0; u < TNU; u++) {
      const ang = (u / TNU) * Math.PI * 2,
        sx = Math.sin(ang) * w
      let sn = Math.cos(ang) * th
      if (sn > 0 && w > 1e-4) sn -= 0.0035 * Math.exp(-(sx * sx) / (w * w * 0.08))
      p.setXYZ(v * TNU + u, sx, cy + Math.cos(a) * sn, cz + Math.sin(a) * sn)
    }
  }
  p.needsUpdate = true
  mesh.geometry.computeVertexNormals()
}
