import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { EXIT_MS, useBackGuard } from '@/presentation/useBackGuard'
import { fakeHistory, type FakeHistory } from './fakeHistory'

const guard = { patitas: 'guard' }

const mount = (tab: FakeHistory, closeTop: () => boolean = () => false) =>
  renderHook(() => useBackGuard(closeTop, { history: tab.history, target: tab.target }))

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))

beforeEach(() => vi.useFakeTimers())
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

  it('closes what is open on back and puts the guard straight back', () => {
    const tab = fakeHistory()
    let open = 1
    const { result } = mount(tab, () => open-- > 0)
    tab.history.back()
    expect(open).toBe(0)
    expect(tab.entries()).toEqual([null, guard])
    expect(result.current.asked).toBe(0)
  })

  it('with nothing open, asks and waits on the page’s own entry, then puts the guard back', () => {
    const tab = fakeHistory()
    const { result } = mount(tab)
    tab.history.back()
    expect(result.current.asked).toBe(1)
    expect(tab.entries()).toEqual([null])
    expect(tab.left()).toBe(false)
    wait(EXIT_MS - 1)
    expect(tab.entries()).toEqual([null])
    wait(1)
    expect(tab.entries()).toEqual([null, guard])
  })

  it('leaves on a second back in time, from a tab opened from another page', () => {
    const tab = fakeHistory()
    mount(tab)
    tab.history.back()
    wait(EXIT_MS - 1)
    tab.history.back()
    expect(tab.left()).toBe(true)
  })

  it('leaves the second back to the system in an installed app, and asks again later', () => {
    // Opened on the game, a back from its first entry is the system's: it closes the app
    const tab = fakeHistory(null, { before: false })
    const { result } = mount(tab)
    tab.history.back()
    expect(tab.entries()).toEqual([null])
    // Had the system not closed it, the next single back after the wait asks again
    wait(EXIT_MS)
    expect(tab.entries()).toEqual([null, guard])
    tab.history.back()
    expect(result.current.asked).toBe(2)
    expect(tab.left()).toBe(false)
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
    wait(EXIT_MS)
    open = true
    tab.history.back()
    tab.history.back()
    expect(tab.left()).toBe(false)
    expect(tab.entries()).toEqual([null])
  })

  it('takes a forward onto the guard for nothing', () => {
    const tab = fakeHistory()
    let asked = 0
    const { result } = mount(tab, () => (asked++, false))
    tab.history.back()
    tab.history.forward()
    expect(asked).toBe(1)
    expect(result.current.asked).toBe(1)
    expect(tab.entries()).toEqual([null, guard])
    wait(EXIT_MS)
    expect(tab.length()).toBe(3)
  })

  it('stops listening and waiting once unmounted', () => {
    const tab = fakeHistory()
    let asked = 0
    const { unmount } = mount(tab, () => (asked++, false))
    tab.history.back()
    unmount()
    wait(EXIT_MS)
    expect(tab.entries()).toEqual([null])
    tab.history.back()
    expect(asked).toBe(1)
  })

  it('puts no guard in front until it is ready, then one', () => {
    const tab = fakeHistory()
    const { rerender } = renderHook(
      ({ ready }) => useBackGuard(() => false, { history: tab.history, target: tab.target }, ready),
      { initialProps: { ready: false } },
    )
    expect(tab.entries()).toEqual([null])
    // A back before then is the page's own: it leaves as it would
    rerender({ ready: true })
    expect(tab.entries()).toEqual([null, guard])
  })

  it('puts the guard straight back when something opens while it waits, so the next back closes it', () => {
    const tab = fakeHistory()
    let open = false
    const { result } = mount(tab, () => {
      const was = open
      open = false
      return was
    })
    tab.history.back()
    expect(tab.entries()).toEqual([null])
    wait(500)
    // A tray opens within the wait: the back after it closes the tray, and does not leave
    open = true
    act(() => result.current.rearm())
    expect(tab.entries()).toEqual([null, guard])
    tab.history.back()
    expect(open).toBe(false)
    expect(tab.left()).toBe(false)
    expect(tab.entries()).toEqual([null, guard])
    // Opening something with the guard in front changes nothing
    act(() => result.current.rearm())
    expect(tab.length()).toBe(3)
  })

  it('never piles up entries, however many times back is pressed', () => {
    const tab = fakeHistory(null, { before: false })
    let open = false
    mount(tab, () => {
      const was = open
      open = false
      return was
    })
    for (let round = 0; round < 30; round++) {
      open = round % 3 === 0
      tab.history.back()
      tab.history.back()
      wait(100)
      tab.history.back()
      wait(EXIT_MS)
      expect(tab.length()).toBeLessThanOrEqual(2)
    }
    expect(tab.entries()).toEqual([null, guard])
  })
})
