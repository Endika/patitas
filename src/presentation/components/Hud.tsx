import type { StageStatus, TrickPose } from '../roomStage'

const TRICKS: [TrickPose, string][] = [
  ['sit', 'Sentado'],
  ['lie', 'Tumbado'],
  ['belly', 'Panza arriba'],
]

/** The room's hint, ball button, tricks and happiness bar. */
export default function Hud({
  status,
  idle,
  onBall,
  onTrick,
}: {
  status: StageStatus
  /** No puppy to play with. */
  idle: boolean
  onBall(inHand: boolean): void
  onTrick(pose: TrickPose): void
}) {
  const happiness = Math.round(status.happiness * 100)
  return (
    <footer className="room-bottom">
      <p className="room-hint" aria-live="polite">
        {status.hint}
      </p>
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
      <div className="room-meter">
        <span id="room-happiness">Felicidad</span>
        <div
          className="room-bar"
          role="meter"
          aria-labelledby="room-happiness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={happiness}
        >
          <i style={{ transform: `scaleX(${status.happiness})` }} />
        </div>
      </div>
    </footer>
  )
}
