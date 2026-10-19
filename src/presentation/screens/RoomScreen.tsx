import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BREEDS } from '@/domain/breeds'
import { comeBack, createCare, type Care } from '@/domain/care'
import type { Puppy } from '@/domain/puppy'
import type { Room } from '@/domain/room'
import CareBar from '../components/CareBar'
import Hud from '../components/Hud'
import NeedsPanel from '../components/NeedsPanel'
import Roster from '../components/Roster'
import UnsavedNotice from '../components/UnsavedNotice'
import type { RoomStage, StageStatus } from '../roomStage'
import { createThreeStage } from '../threeStage'
import { useRoomStage } from '../useRoomStage'
import '../room.css'

const WAITING: StageStatus = {
  hint: '',
  ball: { inHand: false, disabled: true },
  notice: null,
  needs: [],
  touched: null,
  cleaned: false,
}

/** How often the care in the room is saved while it is open, in milliseconds. */
const SAVE_EVERY = 30_000

/** The 3D room with the puppies in it, the list of every adopted one and the play controls. */
export default function RoomScreen({
  puppies,
  room,
  unsaved,
  outside = null,
  onEnter,
  onLeave,
  onAdoptAnother,
  loadCare,
  saveCare,
  now = Date.now,
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
  loadCare(id: string): Promise<Care | undefined>
  saveCare(id: string, care: Care): Promise<void>
  now?: () => number
  createStage?: (canvas: HTMLCanvasElement) => RoomStage
}) {
  /**
   * Saves the care the room keeps of `ids`, or of every puppy in it, as seen now. A save that
   * fails leaves the last one in place, and the room plays on.
   */
  const keep = useCallback(
    (stage: RoomStage, ids?: (id: string) => boolean) => {
      const seen = now()
      for (const [id, care] of stage.cares())
        if (!ids || ids(id)) saveCare(id, { ...care, lastSeen: seen }).catch(() => {})
    },
    [now, saveCare],
  )
  const { hostRef, stageRef, status: reported } = useRoomStage(createStage, keep)
  const status = reported ?? WAITING
  const [full, setFull] = useState(false)
  const [chosen, setChosen] = useState<{ id: string; after: number } | null>(null)
  const [unloaded, setUnloaded] = useState(false)
  const inRoom = useMemo(
    () => room.inRoom.flatMap((id) => puppies.find((p) => p.id === id) ?? []),
    [puppies, room],
  )
  const everyone = useRef(puppies)
  useEffect(() => {
    everyone.current = puppies
  })

  // Those leaving are saved; those coming in bring their care, with the time they were away
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const held = stage.cares()
    keep(stage, (id) => !inRoom.some((p) => p.id === id))
    const coming = inRoom.filter((p) => !held.has(p.id))
    if (!coming.length) {
      stage.setPuppies(inRoom)
      return
    }
    let live = true
    let failed = false
    const load = (id: string) =>
      loadCare(id).catch(() => {
        failed = true
        return undefined
      })
    void Promise.all(coming.map((p) => load(p.id))).then((saved) => {
      if (!live) return
      if (failed) setUnloaded(true)
      const at = now()
      const place = stage.placeAccidents(inRoom.length)
      const cares = new Map(
        coming.map((p, i) => {
          const breed = BREEDS[p.breedId]
          return [p.id, comeBack(saved[i] ?? createCare(breed, at), breed, at, place)] as const
        }),
      )
      stage.setPuppies(inRoom, cares)
    })
    return () => {
      live = false
    }
  }, [createStage, inRoom, stageRef, keep, loadCare, now])

  // A phone can close the app without warning: save every so often and once as it is hidden.
  // Back from hidden, the time away passes for everyone in the room, as if it had been closed.
  useEffect(() => {
    let hiddenAt: number | null = null
    const save = () => {
      if (stageRef.current && hiddenAt === null) keep(stageRef.current)
    }
    const shown = () => {
      const stage = stageRef.current
      if (!stage) return
      if (document.visibilityState === 'hidden') {
        if (hiddenAt !== null) return
        keep(stage)
        hiddenAt = now()
        return
      }
      if (hiddenAt === null) return
      const since = hiddenAt,
        at = now()
      hiddenAt = null
      const held = stage.cares()
      const place = stage.placeAccidents(held.size)
      const cares = new Map<string, Care>()
      for (const [id, care] of held) {
        const puppy = everyone.current.find((p) => p.id === id)
        if (!puppy) continue
        const breed = BREEDS[puppy.breedId]
        cares.set(id, comeBack({ ...care, lastSeen: since }, breed, at, place))
      }
      stage.resume(cares, at - since)
      keep(stage)
    }
    const timer = setInterval(save, SAVE_EVERY)
    document.addEventListener('visibilitychange', shown)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [keep, now, stageRef])

  const touched = status.touched
  const picked = touched && touched.count > (chosen?.after ?? 0) ? touched.id : (chosen?.id ?? null)
  const selected = Math.max(
    0,
    status.needs.findIndex((n) => n.id === picked),
  )

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
        {unloaded && (
          <p role="alert" className="room-note">
            No se han podido cargar los cuidados.
          </p>
        )}
        <NeedsPanel
          needs={status.needs}
          selected={selected}
          onSelect={(id) => setChosen({ id, after: touched?.count ?? 0 })}
        />
      </header>
      {status.cleaned && (
        <p role="status" className="room-toast">
          ¡Limpio!
        </p>
      )}
      <Hud
        status={status}
        idle={!inRoom.length}
        onBall={(inHand) => (inHand ? stageRef.current?.stowBall() : stageRef.current?.takeBall())}
        onTrick={(pose) => stageRef.current?.trick(pose)}
      >
        <CareBar needs={status.needs} selected={selected} stage={() => stageRef.current} />
      </Hud>
      {status.notice && <div className="room-loading">{status.notice}</div>}
    </div>
  )
}
