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
import { useFleeting } from '../useFleeting'
import { useDismiss, type Dismissal } from './useDismiss'

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
  const footer = useRef<HTMLElement>(null)
  const careButton = useRef<HTMLButtonElement>(null),
    tricksButton = useRef<HTMLButtonElement>(null)
  const careId = useId(),
    tricksId = useId()
  // The button that opened the tray gets focus back, unless the player pressed somewhere else
  const close = useCallback(
    (how: Dismissal | 'chosen') => {
      if (how !== 'outside') (tray === 'care' ? careButton : tricksButton).current?.focus()
      setTray(null)
    },
    [tray],
  )
  useDismiss(footer, tray !== null, close)

  const hint = useFleeting(status.hint || null, HINT_MS)

  const open = mode ? null : tray
  useEffect(() => {
    if (open) footer.current?.querySelector<HTMLElement>('.room-tray button')?.focus()
  }, [open])

  // The controls a mode brings take focus, and «Cuidar» gets it back when the mode ends
  const inMode = Boolean(mode)
  const wasInMode = useRef(false)
  useEffect(() => {
    if (inMode) footer.current?.querySelector<HTMLElement>('button')?.focus()
    else if (wasInMode.current) careButton.current?.focus()
    wasInMode.current = inMode
  }, [inMode])

  const toggle = (which: 'care' | 'tricks') => setTray((t) => (t === which ? null : which))
  // Choosing in a tray is done with it
  const chose = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) close('chosen')
  }

  return (
    <footer ref={footer} className="room-bottom">
      <p className="room-hint" aria-live="polite">
        {hint}
      </p>
      {mode ?? (
        <div className="room-actions">
          {care && (
            <button
              type="button"
              ref={careButton}
              aria-expanded={open === 'care'}
              aria-controls={open === 'care' ? careId : undefined}
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
            ref={tricksButton}
            aria-expanded={open === 'tricks'}
            aria-controls={open === 'tricks' ? tricksId : undefined}
            disabled={idle}
            onClick={() => toggle('tricks')}
          >
            Trucos
          </button>
        </div>
      )}
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
    </footer>
  )
}
