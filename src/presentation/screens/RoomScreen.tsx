import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { BREEDS } from '@/domain/breeds'
import { comeBack, createCare, type Care } from '@/domain/care'
import type { Puppy } from '@/domain/puppy'
import type { Room } from '@/domain/room'
import { CareActions, CareMode } from '../components/Care'
import FullscreenButton from '../components/FullscreenButton'
import Hud from '../components/Hud'
import NeedsPanel from '../components/NeedsPanel'
import Roster from '../components/Roster'
import UnsavedNotice from '../components/UnsavedNotice'
import { useDismiss, type Closable, type Dismissal } from '../components/useDismiss'
import type { RoomStage, StageStatus } from '../roomStage'
import { createThreeStage } from '../threeStage'
import { useFleeting } from '../useFleeting'
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

/** How long a notice about who can come in stays up, in milliseconds. */
export const NOTICE_MS = 8000

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
  exitAsked = false,
  onOpen,
  ref,
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
  /** A back with nothing open: one more leaves. */
  exitAsked?: boolean
  /** Something opened that the system back should close: a tray, a card, the list, a bath. */
  onOpen?(): void
  /** Closes what is open in the room for the system back, as Escape or «Terminar» would. */
  ref?: Ref<Closable>
}) {
  /** Puppies whose stored care could not be read: what they play on must not overwrite it. */
  const unreadable = useRef(new Set<string>())
  /**
   * Saves the care the room keeps of `ids`, or of every puppy in it, as seen now. A save that
   * fails leaves the last one in place, and the room plays on.
   */
  const keep = useCallback(
    (stage: RoomStage, ids?: (id: string) => boolean) => {
      const seen = now()
      for (const [id, care] of stage.cares())
        if ((!ids || ids(id)) && !unreadable.current.has(id))
          saveCare(id, { ...care, lastSeen: seen }).catch(() => {})
    },
    [now, saveCare],
  )
  const { hostRef, stageRef, status: reported } = useRoomStage(createStage, keep)
  const status = reported ?? WAITING
  // Counts the refusals, so each one says so again
  const [refused, setRefused] = useState(0)
  const full = useFleeting(refused || null, NOTICE_MS)
  const waiting = useFleeting(outside, NOTICE_MS)
  const [castOpen, setCastOpen] = useState(false)
  const castButton = useRef<HTMLButtonElement>(null)
  const cast = useRef<HTMLDivElement>(null)
  const castId = useId()
  const closeCast = useCallback((how: Dismissal) => {
    if (how === 'escape') castButton.current?.focus()
    setCastOpen(false)
  }, [])
  useDismiss(cast, castOpen, closeCast)
  const [chosen, setChosen] = useState<{ id: string; after: number } | null>(null)
  const [unloaded, setUnloaded] = useState<ReadonlySet<string>>(() => new Set())
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
    const load = (id: string) =>
      loadCare(id).then(
        (care) => ({ care, failed: false }),
        () => ({ care: undefined, failed: true }),
      )
    void Promise.all(coming.map((p) => load(p.id))).then((loaded) => {
      if (!live) return
      coming.forEach((p, i) => {
        if (loaded[i]!.failed) unreadable.current.add(p.id)
        else unreadable.current.delete(p.id)
      })
      setUnloaded(new Set(unreadable.current))
      const at = now()
      const place = stage.placeAccidents(inRoom.length)
      const cares = new Map(
        coming.map((p, i) => {
          const breed = BREEDS[p.breedId]
          const saved = loaded[i]!.care ?? createCare(breed, at)
          return [p.id, comeBack(saved, breed, at, place)] as const
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
    // Opened already in the background, the time away counts from now
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? now() : null
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
      keep(stage, (id) => cares.has(id))
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

  const ringed = status.needs.length > 1 ? selected : null
  useEffect(() => {
    stageRef.current?.select(ringed)
  }, [createStage, ringed, stageRef])

  const toggle = async (puppy: Puppy, isIn: boolean) => {
    if (isIn) {
      await onLeave(puppy.id)
      setRefused(0)
    } else if (await onEnter(puppy.id)) setRefused(0)
    else setRefused((n) => n + 1)
  }

  const empty = !inRoom.length
  const breedOf = (id: string) => {
    const puppy = puppies.find((p) => p.id === id)
    return puppy ? BREEDS[puppy.breedId].label : ''
  }
  const stage = () => stageRef.current
  const busy = status.needs.find((n) => n.mode === 'bath' || n.mode === 'brush')?.mode

  const hud = useRef<Closable>(null),
    card = useRef<Closable>(null)
  const closeTop = () => {
    if (card.current?.close() || hud.current?.close()) return true
    if (castOpen && !empty) {
      closeCast('escape')
      return true
    }
    if (busy === 'bath') stageRef.current?.finishBath()
    else if (busy === 'brush') stageRef.current?.endBrush()
    return Boolean(busy)
  }
  useImperativeHandle(ref, () => ({ close: closeTop }))
  useEffect(() => {
    if (castOpen || busy) onOpen?.()
  }, [castOpen, busy, onOpen])

  return (
    <div className="room">
      <div ref={hostRef} className="room-stage" />
      <header className="room-top">
        <h1 className={empty ? 'room-name' : 'sr-only'}>
          {empty ? 'La sala está vacía' : inRoom.map((p) => p.name).join(' y ')}
        </h1>
        {empty && <p className="room-breed">Mete a un cachorro para jugar.</p>}
        <div className="room-head">
          <NeedsPanel
            ref={card}
            needs={status.needs}
            selected={selected}
            onSelect={(id) => setChosen({ id, after: touched?.count ?? 0 })}
            breedOf={breedOf}
            onOpen={onOpen}
          />
          {/* With nobody in the room, who to bring in is the only thing to do */}
          <div ref={cast} className="room-cast">
            {!empty && (
              <button
                type="button"
                className="room-cast-toggle"
                ref={castButton}
                aria-expanded={castOpen}
                aria-controls={castOpen ? castId : undefined}
                onClick={() => setCastOpen((o) => !o)}
              >
                Cachorros
              </button>
            )}
            {(castOpen || empty) && (
              <div id={castId} className="room-sheet">
                <Roster puppies={puppies} inRoom={room.inRoom} onToggle={toggle} />
                <div className="room-sheet-foot">
                  <button type="button" onClick={onAdoptAnother}>
                    Adoptar otro
                  </button>
                  <FullscreenButton />
                </div>
              </div>
            )}
          </div>
        </div>
        {full && (
          <p role="alert" className="room-note">
            Ya hay dos cachorros en la sala. Saca uno para que entre otro.
          </p>
        )}
        {waiting && (
          <p role="status" className="room-note">
            {waiting} espera fuera: saca a uno para que entre.
          </p>
        )}
        {exitAsked && (
          <p role="status" className="room-note">
            Pulsa atrás otra vez para salir
          </p>
        )}
        {unsaved && <UnsavedNotice className="room-note" />}
        {inRoom.some((p) => unloaded.has(p.id)) && (
          <p role="alert" className="room-note">
            No se han podido cargar los cuidados.
          </p>
        )}
      </header>
      {status.cleaned && (
        <p role="status" className="room-toast">
          ¡Limpio!
        </p>
      )}
      <Hud
        ref={hud}
        status={status}
        idle={empty}
        onBall={(inHand) => (inHand ? stageRef.current?.stowBall() : stageRef.current?.takeBall())}
        onTrick={(pose) => stageRef.current?.trick(selected, pose)}
        care={<CareActions selected={selected} idle={!status.needs.length} stage={stage} />}
        mode={busy ? <CareMode needs={status.needs} stage={stage} /> : undefined}
        onOpen={onOpen}
      />
      {status.notice && <div className="room-loading">{status.notice}</div>}
    </div>
  )
}
