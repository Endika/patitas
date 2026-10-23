import { useEffect, useRef } from 'react'
import { createEars, hearLevel } from '@/engine/audio/onset'
import type { OpenMicrophone } from '@/infrastructure/microphone'

/**
 * While `on` and the page is shown, listens through `open` and calls `heard` with every knock or
 * call; the microphone is let go of as the page hides and taken again as it shows. `failed` says
 * the microphone could not be had, and listening stops there.
 */
export function useListening(
  on: boolean,
  open: OpenMicrophone,
  heard: (kind: 'noise' | 'call') => void,
  failed: () => void,
) {
  const said = useRef({ heard, failed })
  useEffect(() => {
    said.current = { heard, failed }
  })

  useEffect(() => {
    if (!on) return
    let live = true
    let mic: { stop(): void } | null = null
    let opening = false
    const start = () => {
      if (mic || opening || document.visibilityState === 'hidden') return
      opening = true
      const ears = createEars()
      open((db, dt) => {
        const kind = hearLevel(ears, db, dt)
        if (kind) said.current.heard(kind)
      }).then(
        (opened) => {
          opening = false
          if (live && document.visibilityState !== 'hidden') mic = opened
          else opened.stop()
        },
        () => {
          opening = false
          if (live) said.current.failed()
        },
      )
    }
    const stop = () => {
      mic?.stop()
      mic = null
    }
    const shown = () => (document.visibilityState === 'hidden' ? stop() : start())
    start()
    document.addEventListener('visibilitychange', shown)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', shown)
      stop()
    }
  }, [on, open])
}
