/** With `HH:MM`, a clock that starts at that time today and runs on; otherwise `real`. */
export function debugClock(at: string | null, real: () => number): () => number {
  const hm = at && /^(\d{1,2}):(\d{2})$/.exec(at)
  const h = Number(hm?.[1]),
    min = Number(hm?.[2])
  if (!hm || h > 23 || min > 59) return real
  const start = real(),
    fake = new Date(start)
  fake.setHours(h, min, 0, 0)
  const offset = fake.getTime() - start
  return () => real() + offset
}
