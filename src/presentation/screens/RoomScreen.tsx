import { useEffect, useMemo, useState } from 'react'
import { BREEDS } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'
import type { Room } from '@/domain/room'
import Hud from '../components/Hud'
import Roster from '../components/Roster'
import UnsavedNotice from '../components/UnsavedNotice'
import type { RoomStage, StageStatus } from '../roomStage'
import { createThreeStage } from '../threeStage'
import { useRoomStage } from '../useRoomStage'
import '../room.css'

const WAITING: StageStatus = {
  hint: '',
  happiness: 0.25,
  ball: { inHand: false, disabled: true },
  notice: null,
  needs: [],
}

/** The 3D room with the puppies in it, the list of every adopted one and the play controls. */
export default function RoomScreen({
  puppies,
  room,
  unsaved,
  outside = null,
  onEnter,
  onLeave,
  onAdoptAnother,
  createStage = createThreeStage,
}: {
  puppies: Puppy[]
  room: Room
  unsaved: boolean
  /** Name of a puppy just adopted that did not fit in the room. */
  outside?: string | null
  /** False when the room is full. */
  onEnter(id: string): Promise<boolean>
  onLeave(id: string): Promise<void>
  onAdoptAnother(): void
  createStage?: (canvas: HTMLCanvasElement) => RoomStage
}) {
  const { hostRef, stageRef, status: reported } = useRoomStage(createStage)
  const status = reported ?? WAITING
  const [full, setFull] = useState(false)
  const inRoom = useMemo(
    () => room.inRoom.flatMap((id) => puppies.find((p) => p.id === id) ?? []),
    [puppies, room],
  )

  useEffect(() => {
    stageRef.current?.setPuppies(inRoom)
  }, [createStage, inRoom, stageRef])

  const toggle = async (puppy: Puppy, isIn: boolean) => {
    if (isIn) {
      await onLeave(puppy.id)
      setFull(false)
    } else setFull(!(await onEnter(puppy.id)))
  }

  return (
    <div className="room">
      <div ref={hostRef} className="room-stage" />
      <header className="room-top">
        <div className="room-head">
          <div className="room-who">
            <h1 className="room-name">
              {inRoom.length ? inRoom.map((p) => p.name).join(' y ') : 'La sala está vacía'}
            </h1>
            <span className="room-breed">
              {inRoom.length
                ? inRoom.map((p) => BREEDS[p.breedId].label).join(' y ')
                : 'Mete a un cachorro para jugar.'}
            </span>
          </div>
          <button type="button" className="room-adopt" onClick={onAdoptAnother}>
            Adoptar otro
          </button>
        </div>
        <Roster puppies={puppies} inRoom={room.inRoom} onToggle={toggle} />
        {full && (
          <p role="alert" className="room-note">
            Ya hay dos cachorros en la sala. Saca uno para que entre otro.
          </p>
        )}
        {outside && (
          <p role="status" className="room-note">
            {outside} espera fuera: saca a uno para que entre.
          </p>
        )}
        {unsaved && <UnsavedNotice className="room-note" />}
      </header>
      <Hud
        status={status}
        idle={!inRoom.length}
        onBall={(inHand) => (inHand ? stageRef.current?.stowBall() : stageRef.current?.takeBall())}
        onTrick={(pose) => stageRef.current?.trick(pose)}
      />
      {status.notice && <div className="room-loading">{status.notice}</div>}
    </div>
  )
}
