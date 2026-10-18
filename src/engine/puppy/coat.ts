import * as THREE from 'three'
import type { CoatId } from '@/domain/breeds'
import { sm, type PartTag } from './sdf'

/** Surface sample handed to a coat: position, part, normal, skeleton heights and fbm noise. */
export interface CoatInput {
  x: number
  y: number
  z: number
  tag: PartTag
  nx: number
  ny: number
  nz: number
  sy: number
  hY: number
  hZ: number
  n: number
}

export type CoatPalette = Record<string, THREE.Color>
export type CoatFn = (i: CoatInput, pal: CoatPalette, out: THREE.Color) => void

export const RIM = new THREE.Color('#1d140f')
export const GUM = new THREE.Color('#5a2430')

export const FUR_BY_TAG: Record<PartTag, number> = {
  body: 1,
  neck: 1.05,
  head: 0.75,
  cheek: 0.8,
  muzzle: 0.35,
  ear: 0.85,
  leg: 0.75,
  paw: 0.5,
  tail: 1.25,
  tailtip: 1.35,
}

export function paletteColors(palette: Record<string, string>): CoatPalette {
  const out: CoatPalette = {}
  for (const [name, hex] of Object.entries(palette)) out[name] = new THREE.Color(hex)
  return out
}

function swatch(pal: CoatPalette, name: string): THREE.Color {
  const c = pal[name]
  if (!c) throw new Error(`coat palette is missing "${name}"`)
  return c
}

export function coatDorado(i: CoatInput, pal: CoatPalette, out: THREE.Color): void {
  const { y, z, tag, sy, n } = i
  let m = 0
  if (tag === 'muzzle') m = 0.55
  if (tag === 'cheek') m = 0.25
  if (tag === 'body' || tag === 'leg' || tag === 'neck')
    m = Math.max(m, sm(sy - 0.02, sy - 0.14, y))
  if (tag === 'neck' || tag === 'body')
    m = Math.max(m, 0.45 * sm(0.2, 0.32, z) * sm(sy + 0.12, sy, y))
  if (tag === 'paw') m = 0.35
  out.copy(swatch(pal, 'base')).lerp(swatch(pal, 'light'), m)
  if (tag === 'ear') out.lerp(swatch(pal, 'dark'), 0.5)
  out.multiplyScalar(0.9 + 0.2 * n)
}

export function coatShiba(i: CoatInput, pal: CoatPalette, out: THREE.Color): void {
  const { x, y, z, tag, sy, hY, hZ, n } = i
  let m = 0
  if (tag === 'muzzle' || tag === 'cheek') m = 1
  if (tag === 'head') m = sm(hY - 0.02, hY - 0.07, y) * sm(hZ + 0.03, hZ + 0.09, z)
  for (const s of [1, -1]) {
    const dx = x - s * 0.06,
      dy = y - (hY + 0.085),
      dz = z - (hZ + 0.162)
    m = Math.max(m, 1 - sm(0.014, 0.026, Math.sqrt(dx * dx + dy * dy + dz * dz)))
  }
  if (tag === 'neck' || tag === 'body')
    m = Math.max(m, sm(0.14, 0.26, z) * sm(sy + 0.14, sy + 0.02, y))
  if (tag === 'body' || tag === 'leg') m = Math.max(m, sm(sy - 0.04, sy - 0.12, y))
  if (tag === 'leg' || tag === 'paw') m = Math.max(m, sm(0.34, 0.16, y))
  if (tag === 'tail' || tag === 'tailtip') m = Math.max(m, 0.9 * sm(0, -0.5, i.ny))
  if (tag === 'ear') m = Math.max(m, 0.8 * sm(0.2, 0.7, i.nz))
  m = sm(0.38, 0.62, m + (n - 0.5) * 0.3)
  out.copy(swatch(pal, 'red')).lerp(swatch(pal, 'cream'), m)
  if (tag === 'body' && y > sy + 0.08) out.lerp(swatch(pal, 'sesame'), 0.2 * n)
  out.multiplyScalar(0.92 + 0.16 * n)
}

export function coatBeagle(i: CoatInput, pal: CoatPalette, out: THREE.Color): void {
  const { x, y, z, tag, sy, hY, hZ, n } = i
  let w = 0,
    b = 0
  if (tag === 'muzzle') w = 1
  if (tag === 'head')
    w = sm(0.034, 0.016, Math.abs(x)) * sm(hZ + 0.03, hZ + 0.1, z) * sm(hY + 0.17, hY + 0.12, y)
  if (tag === 'cheek') w = Math.max(w, sm(hY - 0.03, hY - 0.08, y))
  if (tag === 'neck' || tag === 'body')
    w = Math.max(w, sm(0.13, 0.25, z) * sm(sy + 0.16, sy + 0.04, y))
  if (tag === 'body') w = Math.max(w, sm(sy - 0.02, sy - 0.11, y))
  if (tag === 'leg' || tag === 'paw') w = Math.max(w, z > 0 ? 1 : sm(0.4, 0.28, y))
  if (tag === 'tailtip') w = 1
  if (tag === 'body' || tag === 'neck') b = sm(sy + 0.03, sy + 0.11, y) * sm(0.22, 0.12, z)
  if (tag === 'tail') b = 0.85
  w = sm(0.4, 0.6, w + (n - 0.5) * 0.3)
  b = sm(0.4, 0.6, b + (n - 0.5) * 0.35)
  const tan = swatch(pal, 'tan')
  out.copy(tan).lerp(swatch(pal, 'black'), b).lerp(swatch(pal, 'white'), w)
  if (tag === 'ear') out.copy(tan).multiplyScalar(0.82)
  out.multiplyScalar(0.93 + 0.14 * n)
}

export const COATS: Record<CoatId, CoatFn> = {
  dorado: coatDorado,
  shiba: coatShiba,
  beagle: coatBeagle,
}
