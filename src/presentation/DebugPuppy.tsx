import { useEffect, useRef, useState } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'
import Hud from './components/Hud'
import type { RoomStage, StageStatus } from './roomStage'
import { createThreeStage } from './threeStage'
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

/** One or two puppies in the room with the prototype's controls, for checking the render by eye. */
export default function DebugPuppy({ breedIds }: { breedIds: BreedId[] }) {
  const key = breedIds.join(',')
  const name = debugNames(breedIds).join(' y ')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<RoomStage | null>(null)
  const [status, setStatus] = useState<StageStatus | null>(null)

  useEffect(() => {
    const stage = createThreeStage(canvasRef.current!)
    stageRef.current = stage
    const off = stage.onChange(setStatus)
    stage.setPuppies(debugPuppies(key.split(',') as BreedId[]))
    return () => {
      off()
      stage.dispose()
      stageRef.current = null
    }
  }, [key])

  return (
    <div className="room">
      <canvas
        ref={canvasRef}
        aria-label="Cachorro en 3D. Mueve el dedo para que te mire y desliza sobre él para acariciarlo."
      />
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
                href={`?debug=puppy&breed=${id}${breedIds[1] ? `&breed2=${breedIds[1]}` : ''}`}
                aria-current={id === breedIds[0] ? 'page' : undefined}
              >
                {BREEDS[id].label}
              </a>
            ))}
          </nav>
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
