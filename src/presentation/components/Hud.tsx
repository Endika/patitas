import type { ReactNode } from 'react'
import type { StageStatus, TrickPose } from '../roomStage'

const TRICKS: [TrickPose, string][] = [
  ['sit', 'Sentado'],
  ['lie', 'Tumbado'],
  ['belly', 'Panza arriba'],
]

/** The room's hint, whatever controls come with it (the care bar), the ball button and tricks. */
export default function Hud({
  status,
  idle,
  onBall,
  onTrick,
  children,
}: {
  status: StageStatus
  /** No puppy to play with. */
  idle: boolean
  onBall(inHand: boolean): void
  onTrick(pose: TrickPose): void
  children?: ReactNode
}) {
  return (
    <footer className="room-bottom">
      <p className="room-hint" aria-live="polite">
        {status.hint}
      </p>
      <div className="room-controls">
        {children}
        <div className="room-play">
          <button
            type="button"
            className="room-ball"
            disabled={idle || status.ball.disabled}
            onClick={() => onBall(status.ball.inHand)}
          >
            {status.ball.inHand ? 'Guardar la pelota' : 'Sacar la pelota'}
          </button>
          <nav className="room-tricks" aria-label="Trucos">
            {TRICKS.map(([pose, label]) => (
              <button key={pose} type="button" disabled={idle} onClick={() => onTrick(pose)}>
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  )
}
