import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { EXIT_MS, useBackGuard } from '@/presentation/useBackGuard'

/** A tab's history: each entry's state, where it stands, and a pop that fires `popstate`. */
function fakeHistory(state: unknown = null) {
  const target = new EventTarget()
  const entries: unknown[] = ['before', state]
  let at = 1
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
      // The first entry is the page before this one: going there leaves
      if (--at === 0) {
        left = true
        return
      }
      act(() => void target.dispatchEvent(new PopStateEvent('popstate', { state: entries[at] })))
    },
  }
  return {
    history,
    target,
    entries: () => entries.slice(1, at + 1),
    left: () => left,
  }
}

const guard = { patitas: 'guard' }

const mount = (
  tab: ReturnType<typeof fakeHistory>,
  closeTop: () => boolean = () => false,
  clock = { now: 0 },
) =>
  renderHook(() =>
    useBackGuard(closeTop, { history: tab.history, target: tab.target, now: () => clock.now }),
  )

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
})
