import { itemOf, type FoodId } from '@/domain/shop'
import type { PuppyNeeds, RoomStage } from '../roomStage'

/**
 * «Comida», each special food there is some of, «Baño», «Cepillo» and «Pesar» for the puppy at
 * `selected` in the room's needs.
 */
export function CareActions({
  selected,
  idle,
  stage,
  foods = [],
  onFood,
}: {
  selected: number
  /** No puppy to look after. */
  idle: boolean
  stage: () => RoomStage | null
  /** The special foods in stock, and how many of each. */
  foods?: { id: FoodId; left: number }[]
  /** A special food went into a bowl. */
  onFood?(id: FoodId): void
}) {
  return (
    <>
      <button type="button" disabled={idle} onClick={() => stage()?.feed(selected)}>
        Comida
      </button>
      {foods.map(({ id, left }) => (
        <button
          key={id}
          type="button"
          disabled={idle}
          aria-label={`${itemOf(id).name}, quedan ${left}`}
          onClick={() => {
            if (stage()?.feed(selected, id)) onFood?.(id)
          }}
        >
          {itemOf(id).short} · {left}
        </button>
      ))}
      <button type="button" disabled={idle} onClick={() => stage()?.bath(selected)}>
        Baño
      </button>
      <button type="button" disabled={idle} onClick={() => stage()?.brush(selected)}>
        Cepillo
      </button>
      <button type="button" disabled={idle} onClick={() => stage()?.weigh(selected)}>
        Pesar
      </button>
    </>
  )
}

/**
 * The only controls while a puppy is in the bath, «Aclarar» or «Secador» and «Terminar», or being
 * brushed, «Terminar»; nothing otherwise.
 */
export function CareMode({ needs, stage }: { needs: PuppyNeeds[]; stage: () => RoomStage | null }) {
  const bathing = needs.find((n) => n.mode === 'bath')
  if (bathing)
    return (
      <nav className="room-mode" aria-label="Baño">
        {bathing.bath === 'scrub' ? (
          <button type="button" onClick={() => stage()?.rinse()}>
            Aclarar
          </button>
        ) : (
          <button type="button" aria-pressed={bathing.dryer} onClick={() => stage()?.dryer()}>
            Secador
          </button>
        )}
        <button type="button" className="room-mode-end" onClick={() => stage()?.finishBath()}>
          Terminar
        </button>
      </nav>
    )
  if (needs.some((n) => n.mode === 'brush'))
    return (
      <nav className="room-mode" aria-label="Cepillo">
        <button type="button" className="room-mode-end" onClick={() => stage()?.endBrush()}>
          Terminar
        </button>
      </nav>
    )
  return null
}
