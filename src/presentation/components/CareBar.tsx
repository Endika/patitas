import type { PuppyNeeds, RoomStage } from '../roomStage'

/**
 * «Comida», «Baño», «Cepillo» and «Pesar» for the puppy at `selected`; in a bath, «Aclarar» or
 * «Secador» and «Terminar»; while brushing, «Terminar».
 */
export default function CareBar({
  needs,
  selected,
  stage,
}: {
  needs: PuppyNeeds[]
  /** Index in `needs` of the puppy being looked after. */
  selected: number
  stage: () => RoomStage | null
}) {
  const bathing = needs.find((n) => n.mode === 'bath')
  if (bathing)
    return (
      <nav className="room-care" aria-label="Baño">
        {bathing.bath === 'scrub' ? (
          <button type="button" onClick={() => stage()?.rinse()}>
            Aclarar
          </button>
        ) : (
          <button type="button" aria-pressed={bathing.dryer} onClick={() => stage()?.dryer()}>
            Secador
          </button>
        )}
        <button type="button" className="room-care-end" onClick={() => stage()?.finishBath()}>
          Terminar
        </button>
      </nav>
    )
  if (needs.some((n) => n.mode === 'brush'))
    return (
      <nav className="room-care" aria-label="Cepillo">
        <button type="button" className="room-care-end" onClick={() => stage()?.endBrush()}>
          Terminar
        </button>
      </nav>
    )
  const idle = !needs.length
  return (
    <nav className="room-care" aria-label="Cuidados">
      <button type="button" disabled={idle} onClick={() => stage()?.feed(selected)}>
        Comida
      </button>
      <button type="button" disabled={idle} onClick={() => stage()?.bath(selected)}>
        Baño
      </button>
      <button type="button" disabled={idle} onClick={() => stage()?.brush(selected)}>
        Cepillo
      </button>
      <button type="button" disabled={idle} onClick={() => stage()?.weigh(selected)}>
        Pesar
      </button>
    </nav>
  )
}
