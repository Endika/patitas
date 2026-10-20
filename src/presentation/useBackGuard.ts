import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/** How long «Pulsa atrás otra vez para salir» waits for a second back that leaves, in ms. */
export const EXIT_MS = 2000

const GUARD = { patitas: 'guard' }

const isGuard = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as typeof GUARD).patitas === GUARD.patitas

/** The history the guard stands in, and where its `popstate` arrives. */
export interface BackGuardHistory {
  history: Pick<History, 'state' | 'pushState'>
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
}

/** How many times the guard has asked, and what puts it back in front at once. */
export interface BackGuard {
  asked: number
  /**
   * Something opened that a back should close (a tray, a sheet, adoption): within EXIT_MS of an
   * ask, the guard goes back in front now, so that back closes it rather than leave.
   */
  rearm(): void
}

/**
 * Keeps the system back gesture in the app: one guard entry stands in front of the page, from
 * when the app is `ready` (its game loaded). A back first closes what is open (`closeTop` says
 * whether it closed anything) and the guard goes back in front. With nothing open it asks for
 * another and leaves the page on its own entry for `EXIT_MS`, so a second back leaves the way the
 * browser or the system would; still here after that, or once something opens, the guard goes
 * back in front. `asked` counts the asks, so each one shows again.
 */
export function useBackGuard(
  closeTop: () => boolean,
  { history = window.history, target = window }: Partial<BackGuardHistory> = {},
  ready = true,
): BackGuard {
  const [asked, setAsked] = useState(0)
  const latest = useRef(closeTop)
  useEffect(() => {
    latest.current = closeTop
  })
  const armed = useRef<() => void>(() => {})

  // Before the screen it guards is painted, so no back comes in between
  useLayoutEffect(() => {
    if (!ready) return
    let rearm: ReturnType<typeof setTimeout> | undefined
    // A reload keeps the guard entry it stood on, so there is never more than one
    const arm = () => {
      clearTimeout(rearm)
      if (!isGuard(history.state)) history.pushState(GUARD, '')
    }
    arm()
    armed.current = arm
    const pop = (event: Event) => {
      // A forward onto the guard is not a back
      if (isGuard((event as PopStateEvent).state)) return
      if (latest.current()) {
        arm()
        return
      }
      clearTimeout(rearm)
      rearm = setTimeout(arm, EXIT_MS)
      setAsked((n) => n + 1)
    }
    target.addEventListener('popstate', pop)
    return () => {
      clearTimeout(rearm)
      armed.current = () => {}
      target.removeEventListener('popstate', pop)
    }
  }, [history, target, ready])

  const rearm = useCallback(() => armed.current(), [])
  return useMemo(() => ({ asked, rearm }), [asked, rearm])
}
