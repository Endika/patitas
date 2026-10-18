export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z)
  const u = x - xi,
    v = y - yi,
    w = z - zi
  const fu = u * u * (3 - 2 * u),
    fv = v * v * (3 - 2 * v),
    fw = w * w * (3 - 2 * w)
  return lerp(
    lerp(
      lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), fu),
      lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), fu),
      fv,
    ),
    lerp(
      lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), fu),
      lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), fu),
      fv,
    ),
    fw,
  )
}

export const fbm = (x: number, y: number, z: number): number =>
  vnoise(x, y, z) * 0.65 + vnoise(x * 2.3 + 17, y * 2.3, z * 2.3) * 0.35
