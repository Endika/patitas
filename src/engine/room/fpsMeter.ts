/** Frames per second over the trailing window, for measuring on a real phone. */
export function createFpsMeter(windowMs = 2000): { frame(now: number): void; fps(): number } {
  const stamps: number[] = []
  return {
    frame(now) {
      stamps.push(now)
      while (stamps.length > 2 && now - stamps[1]! > windowMs) stamps.shift()
    },
    fps() {
      if (stamps.length < 2) return 0
      const span = stamps[stamps.length - 1]! - stamps[0]!
      return span > 0 ? ((stamps.length - 1) * 1000) / span : 0
    },
  }
}
