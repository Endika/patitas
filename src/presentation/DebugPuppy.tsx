import { useCallback } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'
import Hud from './components/Hud'
import { debugClock } from './debugClock'
import { createThreeStage } from './threeStage'
import { useRoomStage } from './useRoomStage'
import './room.css'

const NAMES: Record<BreedId, string> = { dorado: 'Canela', shiba: 'Kuma', beagle: 'Txiki' }

const debugNames = (ids: BreedId[]) =>
  ids.map((id, i) => (i > 0 && id === ids[0] ? `${NAMES[id]} 2` : NAMES[id]))

const debugPuppies = (ids: BreedId[]): Puppy[] => {
  const names = debugNames(ids)
  return ids.map((breedId, i) => ({
    id: `debug-${i}-${breedId}`,
    name: names[i]!,
    breedId,
    persona: BREEDS[breedId].defaultPersona,
    adoptedAt: 0,
  }))
}

/**
 * One or two puppies in the room with the prototype's controls, for checking the render by eye,
 * plus buttons that fill the bowls, send the first puppy into the puddle, have it squat or bathe
 * it, and each puppy's care as the room keeps it.
 */
export default function DebugPuppy({ breedIds, at }: { breedIds: BreedId[]; at: string | null }) {
  const key = breedIds.join(',')
  const name = debugNames(breedIds).join(' y ')
  const createStage = useCallback(
    (canvas: HTMLCanvasElement) => {
      const stage = createThreeStage(canvas, debugClock(at, Date.now))
      stage.setPuppies(debugPuppies(key.split(',') as BreedId[]))
      return stage
    },
    [key, at],
  )
  const { hostRef, stageRef, status } = useRoomStage(createStage)

  return (
    <div className="room">
      <div ref={hostRef} className="room-stage" />
      <header className="room-top">
        <div className="room-head">
          <div className="room-who">
            <span className="room-name">{name}</span>
            <span className="room-breed">
              {breedIds.map((id) => BREEDS[id].label).join(' y ')} · 3 meses
            </span>
          </div>
          <nav className="room-breeds" aria-label="Raza">
            {(Object.keys(BREEDS) as BreedId[]).map((id) => (
              <a
                key={id}
                href={`?debug=puppy&breed=${id}${breedIds[1] ? `&breed2=${breedIds[1]}` : ''}${at ? `&now=${encodeURIComponent(at)}` : ''}`}
                aria-current={id === breedIds[0] ? 'page' : undefined}
              >
                {BREEDS[id].label}
              </a>
            ))}
          </nav>
        </div>
        <div className="room-debug">
          <button type="button" onClick={() => stageRef.current?.feed()}>
            Comida
          </button>
          <button type="button" onClick={() => stageRef.current?.toMud?.()}>
            Barro
          </button>
          <button type="button" onClick={() => stageRef.current?.relieve?.('pee')}>
            Pis
          </button>
          <button type="button" onClick={() => stageRef.current?.relieve?.('poop')}>
            Caca
          </button>
          {debugNames(breedIds).map((n, i) => (
            <button key={n} type="button" onClick={() => stageRef.current?.bath(i)}>
              {breedIds.length > 1 ? `Baño ${n}` : 'Baño'}
            </button>
          ))}
          <button type="button" onClick={() => stageRef.current?.rinse()}>
            Aclarar
          </button>
          <button type="button" onClick={() => stageRef.current?.dryer()}>
            Secador
          </button>
          <button type="button" onClick={() => stageRef.current?.finishBath()}>
            Terminar
          </button>
          {status?.needs.map((n) => (
            <span key={n.name}>
              {n.name}: hambre {n.hunger.toFixed(2)} · cuenco {n.bowl.toFixed(2)} ·{' '}
              {n.weightKg.toFixed(2)} kg · limpieza {n.cleanliness.toFixed(2)} · mojado{' '}
              {n.wet.toFixed(2)}
            </span>
          ))}
        </div>
      </header>
      {status && (
        <Hud
          status={status}
          idle={false}
          onBall={(inHand) =>
            inHand ? stageRef.current?.stowBall() : stageRef.current?.takeBall()
          }
          onTrick={(pose) => stageRef.current?.trick(pose)}
        />
      )}
      {status?.notice && <div className="room-loading">{status.notice}</div>}
    </div>
  )
}
