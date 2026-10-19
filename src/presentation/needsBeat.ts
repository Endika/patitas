import type { PuppyNeeds } from './roomStage'

/** How often the needs are told while they only drift, in seconds. */
export const NEEDS_EVERY = 0.25

/**
 * The needs as the room tells them: built `of` each puppy at most every NEEDS_EVERY seconds while
 * they only drift, and at once when the puppies change or `same` finds what the care bar follows
 * has. Between beats it returns the same array.
 */
export function needsBeat<V>(
  of: (v: V) => PuppyNeeds,
  same: (told: PuppyNeeds, v: V) => boolean,
): (views: readonly V[], dt: number) => PuppyNeeds[] {
  let needs: PuppyNeeds[] = []
  let t = 0
  return (views, dt) => {
    t += dt
    if (
      t >= NEEDS_EVERY ||
      needs.length !== views.length ||
      views.some((v, i) => !same(needs[i]!, v))
    ) {
      needs = views.map(of)
      t = 0
    }
    return needs
  }
}
