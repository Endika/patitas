import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { StageStatus, TrickPose } from '../roomStage'
import { useDismiss } from './useDismiss'

const TRICKS: [TrickPose, string][] = [
  ['sit', 'Sentado'],
  ['lie', 'Tumbado'],
  ['belly', 'Panza arriba'],
]

/** How long a hint stays up, in milliseconds; a new one shows again. */
export const HINT_MS = 6000

/**
 * The room's controls: «Cuidar» and «Trucos», each opening a tray, and the ball between them; or,
 * while a puppy is bathed or brushed, only that mode's controls. A new hint shows for a while.
 */
export default function Hud({
  status,
  idle,
  onBall,
  onTrick,
  care,
  mode,
}: {
  status: StageStatus
  /** No puppy to play with. */
  idle: boolean
  onBall(inHand: boolean): void
  onTrick(pose: TrickPose): void
  /** The care actions «Cuidar» opens; without them there is no «Cuidar». */
  care?: ReactNode
  /** Controls that take the place of everything else while they last. */
  mode?: ReactNode
}) {
  const [tray, setTray] = useState<'care' | 'tricks' | null>(null)
  const [expired, setExpired] = useState<string | null>(null)
  const footer = useRef<HTMLElement>(null)
  const careId = useId(),
    tricksId = useId()
  const close = useCallback(() => setTray(null), [])
  useDismiss(footer, tray !== null, close)

  const hint = status.hint
  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setExpired(hint), HINT_MS)
    return () => clearTimeout(timer)
  }, [hint])

  const toggle = (which: 'care' | 'tricks') => setTray((t) => (t === which ? null : which))
  // Choosing in a tray is done with it
  const chose = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) close()
  }
  const open = mode ? null : tray

  return (
    <footer ref={footer} className="room-bottom">
      <p className="room-hint" aria-live="polite">
        {hint !== expired ? hint : ''}
      </p>
      {open === 'care' && (
        <nav id={careId} className="room-tray" aria-label="Cuidados" onClick={chose}>
          {care}
        </nav>
      )}
      {open === 'tricks' && (
        <nav id={tricksId} className="room-tray" aria-label="Trucos" onClick={chose}>
          {TRICKS.map(([pose, label]) => (
            <button key={pose} type="button" onClick={() => onTrick(pose)}>
              {label}
            </button>
          ))}
        </nav>
      )}
      {mode ?? (
        <div className="room-actions">
          {care && (
            <button
              type="button"
              aria-expanded={open === 'care'}
              aria-controls={careId}
              disabled={idle}
              onClick={() => toggle('care')}
            >
              Cuidar
            </button>
          )}
          <button
            type="button"
            className="room-ball"
            disabled={idle || status.ball.disabled}
            onClick={() => onBall(status.ball.inHand)}
          >
            {status.ball.inHand ? 'Guardar la pelota' : 'Sacar la pelota'}
          </button>
          <button
            type="button"
            aria-expanded={open === 'tricks'}
            aria-controls={tricksId}
            disabled={idle}
            onClick={() => toggle('tricks')}
          >
            Trucos
          </button>
        </div>
      )}
    </footer>
  )
}
