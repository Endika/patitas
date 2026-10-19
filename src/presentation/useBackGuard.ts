import { useEffect, useRef, useState } from 'react'

/** How long after «Pulsa atrás otra vez para salir» a second back leaves, in milliseconds. */
export const EXIT_MS = 2000

const GUARD = { patitas: 'guard' }

const isGuard = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as typeof GUARD).patitas === GUARD.patitas

/**
 * Whether the app runs installed rather than in a browser tab. A tab in element fullscreen also
 * reads as the fullscreen display mode, so that alone does not count.
 */
const runsInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.matchMedia('(display-mode: fullscreen)').matches && !document.fullscreenElement)

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
    installed = runsInstalled,
    close = () => window.close(),
  }: {
    history?: Pick<History, 'state' | 'pushState' | 'back'>
    target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
    now?: () => number
    installed?: () => boolean
    /** Closes an installed app, where the browser lets a page do it. */
    close?: () => void
  } = {},
): number {
  const [asked, setAsked] = useState(0)
  const latest = useRef({ closeTop, now, installed, close })
  useEffect(() => {
    latest.current = { closeTop, now, installed, close }
  })

  useEffect(() => {
    let askedAt: number | null = null
    let rearm: ReturnType<typeof setTimeout> | undefined
    // A reload keeps the guard entry it stood on, so there is never more than one
    const arm = () => {
      clearTimeout(rearm)
      askedAt = null
      if (!isGuard(history.state)) history.pushState(GUARD, '')
    }
    arm()
    const pop = () => {
      const { closeTop, now, installed, close } = latest.current
      if (closeTop()) {
        arm()
        return
      }
      const at = now()
      if (askedAt !== null && at - askedAt < EXIT_MS) {
        // Past the guard already: in a tab one more step back is the page before the game; an
        // installed app sits on its first entry, where the next system back closes it
        if (installed()) close()
        else history.back()
        // Still here once the time to leave is over, the guard goes back in front
        rearm = setTimeout(arm, askedAt + EXIT_MS - at)
        return
      }
      arm()
      askedAt = at
      setAsked((n) => n + 1)
    }
    target.addEventListener('popstate', pop)
    return () => {
      clearTimeout(rearm)
      target.removeEventListener('popstate', pop)
    }
  }, [history, target])

  return asked
}
