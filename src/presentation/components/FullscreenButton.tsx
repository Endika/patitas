import { useEffect, useState } from 'react'

/** What the button needs of the document; `fullscreenEnabled` is missing on an iPhone. */
export interface FullscreenDocument {
  fullscreenEnabled?: boolean
  readonly fullscreenElement: Element | null
  documentElement: { requestFullscreen(): Promise<void> }
  exitFullscreen(): Promise<void>
  addEventListener(type: 'fullscreenchange', listener: () => void): void
  removeEventListener(type: 'fullscreenchange', listener: () => void): void
}

/** What the button needs of the window: its display mode and the screen's orientation lock. */
export interface FullscreenWindow {
  matchMedia(query: string): { matches: boolean }
  screen: {
    orientation?: { type: string; lock?(orientation: string): Promise<void> }
  }
}

/**
 * Puts the whole page in fullscreen and out again, where the browser can and the app did not
 * already open in fullscreen. Entering keeps the orientation the phone is held in.
 */
export default function FullscreenButton({
  doc = document,
  win = window,
}: {
  doc?: FullscreenDocument
  win?: FullscreenWindow
}) {
  const [full, setFull] = useState(() => doc.fullscreenElement !== null)
  useEffect(() => {
    const change = () => setFull(doc.fullscreenElement !== null)
    doc.addEventListener('fullscreenchange', change)
    return () => doc.removeEventListener('fullscreenchange', change)
  }, [doc])

  // A page in fullscreen reads as the fullscreen display mode too, and still needs its way out
  if (doc.fullscreenEnabled !== true) return null
  if (!full && win.matchMedia('(display-mode: fullscreen)').matches) return null

  const toggle = () => {
    if (full) {
      doc.exitFullscreen().catch(() => {})
      return
    }
    const orientation = win.screen.orientation
    doc.documentElement
      .requestFullscreen()
      .then(() => orientation?.lock?.(orientation.type))
      .catch(() => {})
  }

  const label = full ? 'Salir de pantalla completa' : 'Pantalla completa'
  return (
    <button
      type="button"
      className="room-fullscreen"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d={
            full
              ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
              : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'
          }
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
