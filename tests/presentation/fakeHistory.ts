import { act } from '@testing-library/react'

/**
 * A tab's history: each entry's state, where it stands, and a back or forward that fires
 * `popstate` with the state it lands on. Opened from another page, a back from the game's first
 * entry leaves it; opened on the game, as an installed app is, it does nothing here (the system
 * closes the app).
 */
export function fakeHistory(state: unknown = null, { before = true } = {}) {
  const target = new EventTarget()
  const first = before ? 1 : 0
  const entries: unknown[] = before ? ['before', state] : [state]
  let at = first
  let left = false
  const pop = () =>
    act(() => void target.dispatchEvent(new PopStateEvent('popstate', { state: entries[at] })))
  const history = {
    get state() {
      return entries[at]
    },
    pushState(next: unknown) {
      entries.splice(at + 1, Infinity, next)
      at++
    },
    back() {
      if (left || at === 0) return
      if (--at < first) {
        left = true
        return
      }
      pop()
    },
    forward() {
      if (left || at === entries.length - 1) return
      at++
      pop()
    },
  }
  return {
    history,
    target,
    /** The game's entries up to where the tab stands. */
    entries: () => entries.slice(first, at + 1),
    /** Every entry the tab holds, forward ones too. */
    length: () => entries.length,
    left: () => left,
  }
}

export type FakeHistory = ReturnType<typeof fakeHistory>
