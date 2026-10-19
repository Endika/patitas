import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { EXIT_MS, useBackGuard } from '@/presentation/useBackGuard'

/**
 * A tab's history: each entry's state, where it stands, and a pop that fires `popstate`. Opened
 * from another page, a back from the game's first entry leaves; opened on the game, it does nothing.
 */
function fakeHistory(state: unknown = null, { before = true } = {}) {
  const target = new EventTarget()
  const first = before ? 1 : 0
  const entries: unknown[] = before ? ['before', state] : [state]
  let at = first
  let left = false
  const history = {
    get state() {
      return entries[at]
    },
    pushState(next: unknown) {
      entries.splice(at + 1, Infinity, next)
      at++
    },
    back() {
      if (at === 0) return
      if (--at < first) {
        left = true
        return
      }
      act(() => void target.dispatchEvent(new PopStateEvent('popstate', { state: entries[at] })))
    },
  }
  return {
    history,
    target,
    entries: () => entries.slice(first, at + 1),
    /** Every entry the tab holds, forward ones too. */
    length: () => entries.length,
    left: () => left,
  }
}

const guard = { patitas: 'guard' }

const mount = (
  tab: ReturnType<typeof fakeHistory>,
  closeTop: () => boolean = () => false,
  clock = { now: 0 },
  installed = false,
) => {
  let closed = 0
  const view = renderHook(() =>
    useBackGuard(closeTop, {
      history: tab.history,
      target: tab.target,
      now: () => clock.now,
      installed: () => installed,
      close: () => void closed++,
    }),
  )
  return { ...view, closed: () => closed }
}

/** Time passes for both the clock the guard reads and its timers. */
const pass = (clock: { now: number }, ms: number) => {
  clock.now += ms
  act(() => vi.advanceTimersByTime(ms))
}

afterEach(() => vi.useRealTimers())

describe('useBackGuard', () => {
  it('puts one guard entry in front of the page as it mounts', () => {
    const tab = fakeHistory()
    mount(tab)
    expect(tab.entries()).toEqual([null, guard])
  })

  it('adds no other guard on a reload or a second mount', () => {
    const tab = fakeHistory(guard)
    renderHook(() => useBackGuard(() => false, { history: tab.history, target: tab.target }), {
      wrapper: StrictMode,
    })
    expect(tab.entries()).toEqual([guard])
  })

  it('closes what is open on back and stays in front of the page', () => {
    const tab = fakeHistory()
    let open = 1
    const { result } = mount(tab, () => open-- > 0)
    tab.history.back()
    expect(open).toBe(0)
    expect(tab.entries()).toEqual([null, guard])
    expect(result.current).toBe(0)
  })

  it('with nothing open, asks for another back and stays', () => {
    const tab = fakeHistory()
    const { result } = mount(tab)
    tab.history.back()
    expect(result.current).toBe(1)
    expect(tab.entries()).toEqual([null, guard])
    expect(tab.left()).toBe(false)
  })

  it('leaves on a second back in time', () => {
    const tab = fakeHistory()
    const clock = { now: 0 }
    mount(tab, () => false, clock)
    tab.history.back()
    clock.now = EXIT_MS - 1
    tab.history.back()
    expect(tab.left()).toBe(true)
  })

  it('asks again when the second back comes too late', () => {
    const tab = fakeHistory()
    const clock = { now: 0 }
    const { result } = mount(tab, () => false, clock)
    tab.history.back()
    clock.now = EXIT_MS
    tab.history.back()
    expect(result.current).toBe(2)
    expect(tab.left()).toBe(false)
    expect(tab.entries()).toEqual([null, guard])
  })

  it('a back that closes something does not count towards leaving', () => {
    const tab = fakeHistory()
    let open = false
    mount(tab, () => {
      const was = open
      open = false
      return was
    })
    tab.history.back()
    open = true
    tab.history.back()
    tab.history.back()
    expect(tab.left()).toBe(false)
  })

  it('stops listening once unmounted', () => {
    const tab = fakeHistory()
    let asked = 0
    const { unmount } = mount(tab, () => (asked++, false))
    unmount()
    tab.history.back()
    expect(asked).toBe(0)
  })

  it('in a tab opened on the game, puts the guard back once the time to leave is over', () => {
    vi.useFakeTimers()
    const tab = fakeHistory(null, { before: false })
    const clock = { now: 0 }
    const { result } = mount(tab, () => false, clock)
    tab.history.back()
    pass(clock, 500)
    tab.history.back()
    expect(tab.entries()).toEqual([null])
    pass(clock, EXIT_MS - 501)
    expect(tab.entries()).toEqual([null])
    pass(clock, 1)
    expect(tab.entries()).toEqual([null, guard])
    // A single back stays in the game and asks again
    tab.history.back()
    expect(result.current).toBe(2)
    expect(tab.entries()).toEqual([null, guard])
  })

  it('installed, closes the app on the second back, or waits on the first entry for the system', () => {
    vi.useFakeTimers()
    const tab = fakeHistory(null, { before: false })
    const clock = { now: 0 }
    const { result, closed } = mount(tab, () => false, clock, true)
    tab.history.back()
    pass(clock, 1500)
    tab.history.back()
    expect(closed()).toBe(1)
    expect(tab.left()).toBe(false)
    // Nothing goes back in front in time for the next system back to close the app natively
    expect(tab.entries()).toEqual([null])
    pass(clock, 499)
    expect(tab.entries()).toEqual([null])
    // Still open after that, the guard is back and a later back asks again
    pass(clock, 1)
    expect(tab.entries()).toEqual([null, guard])
    tab.history.back()
    expect(result.current).toBe(2)
    expect(closed()).toBe(1)
  })

  it('never piles up entries, however many times back is pressed', () => {
    vi.useFakeTimers()
    const tab = fakeHistory(null, { before: false })
    const clock = { now: 0 }
    let open = false
    mount(
      tab,
      () => {
        const was = open
        open = false
        return was
      },
      clock,
      true,
    )
    for (let round = 0; round < 30; round++) {
      open = round % 3 === 0
      tab.history.back()
      tab.history.back()
      pass(clock, 100)
      tab.history.back()
      pass(clock, EXIT_MS)
      expect(tab.length()).toBeLessThanOrEqual(2)
    }
    expect(tab.entries()).toEqual([null, guard])
  })
})
