import { useCallback, useId, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { PuppyNeeds } from '../roomStage'
import { useDismiss, type Closable, type Dismissal } from './useDismiss'

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
 * A chip for each puppy in the room with its name, how happy it is, its health and what the scale
 * read; a tap opens its card with its breed and every need. With two, the chip tapped also picks
 * the puppy the care actions look after, marked as the current one.
 */
export default function NeedsPanel({
  needs,
  selected,
  onSelect,
  breedOf,
  ref,
}: {
  needs: PuppyNeeds[]
  selected: number
  onSelect(id: string): void
  /** The breed's name of the puppy with this id. */
  breedOf(id: string): string
  /** Closes the open card, as Escape does. */
  ref?: Ref<Closable>
}) {
  const [open, setOpen] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const chips = useRef(new Map<string, HTMLButtonElement>())
  const cardId = useId()
  // Escape gives focus back to the chip whose card it closes
  const close = useCallback(
    (how: Dismissal) => {
      if (how === 'escape' && open) chips.current.get(open)?.focus()
      setOpen(null)
    },
    [open],
  )
  const shown = needs.find((n) => n.id === open)
  useDismiss(box, !!shown, close)
  useImperativeHandle(
    ref,
    () => ({
      close: () => {
        if (!shown) return false
        close('escape')
        return true
      },
    }),
    [shown, close],
  )
  if (!needs.length) return null
  const two = needs.length > 1

  return (
    <div ref={box} className="room-needs">
      <div className="room-pups">
        {needs.map((n, i) => (
          <button
            key={n.id}
            type="button"
            className="room-pup"
            ref={(chip) => {
              if (chip) chips.current.set(n.id, chip)
              else chips.current.delete(n.id)
            }}
            aria-current={(two && i === selected) || undefined}
            aria-expanded={open === n.id}
            aria-controls={open === n.id ? cardId : undefined}
            onClick={() => {
              if (two) onSelect(n.id)
              setOpen(open === n.id ? null : n.id)
            }}
          >
            <span className="room-pup-name">{n.name}</span>
            <span className="sr-only">, {n.health}</span>
            <span className="room-pup-health" data-health={n.health} aria-hidden="true" />
            <span className="room-pup-mood" aria-hidden="true">
              <i style={{ transform: `scaleX(${n.happiness})` }} />
            </span>
            {n.reading && <small className="room-pup-weight">{n.reading}</small>}
          </button>
        ))}
      </div>
      {shown && (
        <section id={cardId} aria-label={shown.name} className="room-need">
          <p className="room-need-head">
            <span>
              {shown.name} <span className="room-need-breed">· {breedOf(shown.id)}</span>
            </span>
            <small data-health={shown.health}>{shown.health}</small>
          </p>
          {BARS.map(([key, label]) => (
            <Meter key={key} label={label} value={shown[key]} />
          ))}
          {shown.reading && (
            <p className="room-need-weight">
              {shown.reading} · {shown.weightStatus}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
