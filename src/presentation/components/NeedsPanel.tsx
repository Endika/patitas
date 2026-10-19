import { useId } from 'react'
import type { PuppyNeeds } from '../roomStage'

const BARS: ['happiness' | 'hunger' | 'cleanliness' | 'energy', string][] = [
  ['happiness', 'Felicidad'],
  ['hunger', 'Hambre'],
  ['cleanliness', 'Limpieza'],
  ['energy', 'Energía'],
]

function Meter({ label, value }: { label: string; value: number }) {
  const id = useId()
  return (
    <div className="room-need-bar">
      <span id={id}>{label}</span>
      <div
        className="room-bar"
        role="meter"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <i style={{ transform: `scaleX(${value})` }} />
      </div>
    </div>
  )
}

/**
 * A card for each puppy in the room with its name, health, happiness, hunger, cleanliness and
 * energy, and what the scale read. With two, a card picks the puppy the care bar looks after.
 */
export default function NeedsPanel({
  needs,
  selected,
  onSelect,
}: {
  needs: PuppyNeeds[]
  selected: number
  onSelect(id: string): void
}) {
  if (!needs.length) return null
  const two = needs.length > 1
  return (
    <div className="room-needs" data-two={two || undefined}>
      {needs.map((n, i) => (
        <section
          key={n.id}
          aria-label={n.name}
          className="room-need"
          data-selected={(two && i === selected) || undefined}
          onClick={two ? () => onSelect(n.id) : undefined}
        >
          <div className="room-need-head">
            {two ? (
              <button type="button" aria-pressed={i === selected}>
                {n.name}
              </button>
            ) : (
              <span>{n.name}</span>
            )}
            <small data-health={n.health}>{n.health}</small>
          </div>
          {BARS.map(([key, label]) => (
            <Meter key={key} label={label} value={n[key]} />
          ))}
          {n.reading && (
            <p className="room-need-weight">
              {n.reading} · {n.weightStatus}
            </p>
          )}
        </section>
      ))}
    </div>
  )
}
