import { useEffect, useRef, useState } from 'react'

/** How long after «Pulsa atrás otra vez para salir» a second back leaves, in milliseconds. */
export const EXIT_MS = 2000

const GUARD = { patitas: 'guard' }

const isGuard = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as typeof GUARD).patitas === GUARD.patitas

/**
 * Keeps the system back gesture in the game: a back first closes what is open (`closeTop` says
 * whether it closed anything); with nothing open it asks for another, and a second one within
 * `EXIT_MS` leaves. Returns how many times it has asked, so each ask can show again.
 */
export function useBackGuard(
  closeTop: () => boolean,
  {
    history = window.history,
    target = window,
    now = Date.now,
  }: {
    history?: Pick<History, 'state' | 'pushState' | 'back'>
    target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
    now?: () => number
  } = {},
): number {
  const [asked, setAsked] = useState(0)
  const latest = useRef({ closeTop, now })
  useEffect(() => {
    latest.current = { closeTop, now }
  })

  useEffect(() => {
    // A reload keeps the guard entry it stood on, so there is never more than one
    if (!isGuard(history.state)) history.pushState(GUARD, '')
    let askedAt: number | null = null
    const pop = () => {
      const { closeTop, now } = latest.current
      if (closeTop()) {
        askedAt = null
      } else if (askedAt !== null && now() - askedAt < EXIT_MS) {
        // Past the guard already: one more step back is the page before the game
        history.back()
        return
      } else {
        askedAt = now()
        setAsked((n) => n + 1)
      }
      history.pushState(GUARD, '')
    }
    target.addEventListener('popstate', pop)
    return () => target.removeEventListener('popstate', pop)
  }, [history, target])

  return asked
}
