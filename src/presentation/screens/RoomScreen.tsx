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
import { knows, traits, TREAT_LESSON, type Puppy, type Trick } from '@/domain/puppy'
import type { Room } from '@/domain/room'
import {
  SHOP,
  type CollarLook,
  type Consumable,
  type FoodId,
  type ItemId,
  type Keepsake,
  type ToyId,
} from '@/domain/shop'
import type { Settings } from '@/domain/settings'
import type { Deed, Wallet } from '@/domain/wallet'
import { openMicrophone, type OpenMicrophone } from '@/infrastructure/microphone'
import { CareActions, CareMode } from '../components/Care'
import FullscreenButton from '../components/FullscreenButton'
import Hud from '../components/Hud'
import NeedsPanel from '../components/NeedsPanel'
import Roster from '../components/Roster'
import Shop from '../components/Shop'
import UnsavedNotice from '../components/UnsavedNotice'
import { useDismiss, type Closable, type Dismissal } from '../components/useDismiss'
import type { RoomStage, StageStatus } from '../roomStage'
import { createThreeStage } from '../threeStage'
import { TRICKS } from '../tricks'
import { useFleeting } from '../useFleeting'
import { useListening } from '../useListening'
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

/** How the ball button names each toy. */
const TOY_NAMES: Record<ToyId, string> = {
  ball: 'la pelota',
  bone: 'el hueso',
  plush: 'el peluche',
}

/** How long «+5» stays up after coins are earned, in milliseconds. */
export const GAIN_MS = 1500

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
  wallet,
  onDeed,
  onBuy,
  onSpend,
  onTeach,
  onUse,
  onWear,
  settings,
  onSettle,
  openMic = openMicrophone,
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
  wallet: Wallet
  /** Pays for a deed done in the room: the coins gained, 0 when none. */
  onDeed(deed: Deed): number
  /** False when the coins do not reach. */
  onBuy(id: ItemId): boolean
  /** Uses one up. */
  onSpend(id: Consumable): boolean
  /** Puts a keepsake to use: the toy the ball button throws, or a colour for the room. */
  onUse(id: Keepsake): void
  /** Puts a collar on a puppy, or takes its collar off. */
  onWear(id: string, collar: CollarLook | null): Promise<void>
  /** The player's choices about the app: «Escuchar» among them. */
  settings: Settings
  onSettle(change: Partial<Settings>): void
  /** Where the sound comes from: the phone's microphone unless a test brings its own. */
  openMic?: OpenMicrophone
  /** A treat taught a puppy a little more of a trick. */
  onTeach(id: string, trick: Trick): Promise<void>
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
  // Counts the gains, so the same amount twice shows again
  const [gain, setGain] = useState<{ coins: number; n: number } | null>(null)
  const deed = useCallback(
    (d: Deed) => {
      const coins = onDeed(d)
      if (coins) setGain((g) => ({ coins, n: (g?.n ?? 0) + 1 }))
    },
    [onDeed],
  )
  const gained = useFleeting(gain, GAIN_MS)
  // Counts the lessons, so the same one twice shows again
  const [lesson, setLesson] = useState<{ text: string; n: number } | null>(null)
  const learnt = useFleeting(lesson, NOTICE_MS)
  const { hostRef, stageRef, status: reported } = useRoomStage(createStage, keep, deed)
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
  const [shopOpen, setShopOpen] = useState(false)
  const shopButton = useRef<HTMLButtonElement>(null)
  const shop = useRef<HTMLDivElement>(null)
  const shopId = useId()
  const closeShop = useCallback((how: Dismissal) => {
    if (how === 'escape') shopButton.current?.focus()
    setShopOpen(false)
  }, [])
  useDismiss(shop, shopOpen, closeShop)
  // «Escuchar» explained before the browser asks for the microphone, the first time
  const [asking, setAsking] = useState(false)
  const earButton = useRef<HTMLButtonElement>(null)
  const ear = useRef<HTMLDivElement>(null)
  const askId = useId()
  const closeAsk = useCallback((how: Dismissal) => {
    if (how === 'escape') earButton.current?.focus()
    setAsking(false)
  }, [])
  useDismiss(ear, asking, closeAsk)
  const toggleListen = () => {
    if (settings.listen) onSettle({ listen: false })
    else if (settings.explained) onSettle({ listen: true })
    else setAsking((a) => !a)
  }
  // Counts the failures, so each one says so again
  const [deaf, setDeaf] = useState(0)
  const micLost = useFleeting(deaf || null, NOTICE_MS)
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

  useListening(
    settings.listen && inRoom.length > 0,
    openMic,
    (kind) => stageRef.current?.hear(kind),
    () => {
      onSettle({ listen: false })
      setDeaf((n) => n + 1)
    },
  )
  useEffect(() => {
    stageRef.current?.setToy(wallet.toy)
  }, [createStage, wallet.toy, stageRef])
  useEffect(() => {
    stageRef.current?.setDecor(wallet.decor)
  }, [createStage, wallet.decor, stageRef])
  useEffect(() => {
    for (const p of inRoom) stageRef.current?.setCollar(p.id, p.collar ?? null)
  }, [createStage, inRoom, stageRef])

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
  const traitsOf = (id: string) => {
    const puppy = puppies.find((p) => p.id === id)
    return puppy ? traits(puppy.persona) : []
  }
  const stage = () => stageRef.current
  /** The puppy a collar goes on: the one the buttons are for. */
  const wearer = inRoom.find((p) => p.id === status.needs[selected]?.id) ?? inRoom[0]
  const treats = wallet.stock.treat ?? 0
  const giveTreat = () => {
    const given = stageRef.current?.treat(selected)
    if (!given) return
    onSpend('treat')
    const who = status.needs[selected]
    const puppy = who && puppies.find((p) => p.id === who.id)
    if (!given.taught || !puppy) return
    const label = TRICKS.find(([pose]) => pose === given.taught)![1]
    const known = knows(puppy, given.taught) + TREAT_LESSON >= 1
    setLesson((l) => ({
      text: known ? `${puppy.name} ya sabe «${label}»` : `${puppy.name} aprende «${label}»`,
      n: (l?.n ?? 0) + 1,
    }))
    onTeach(puppy.id, given.taught).catch(() => {})
  }
  const foods = SHOP.flatMap((item) => {
    const left = item.aisle === 'food' ? (wallet.stock[item.id as FoodId] ?? 0) : 0
    return left ? [{ id: item.id as FoodId, left }] : []
  })
  const busy = status.needs.find((n) => n.mode === 'bath' || n.mode === 'brush')?.mode

  const hud = useRef<Closable>(null),
    card = useRef<Closable>(null)
  const closeTop = () => {
    if (card.current?.close() || hud.current?.close()) return true
    if (castOpen && !empty) {
      closeCast('escape')
      return true
    }
    if (shopOpen) {
      closeShop('escape')
      return true
    }
    if (asking) {
      closeAsk('escape')
      return true
    }
    if (busy === 'bath') stageRef.current?.finishBath()
    else if (busy === 'brush') stageRef.current?.endBrush()
    return Boolean(busy)
  }
  useImperativeHandle(ref, () => ({ close: closeTop }))
  useEffect(() => {
    if (castOpen || shopOpen || asking || busy) onOpen?.()
  }, [castOpen, shopOpen, asking, busy, onOpen])

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
            traitsOf={traitsOf}
            onOpen={onOpen}
          />
          <div className="room-side">
            <div ref={ear} className="room-ear">
              <button
                type="button"
                className="room-listen"
                ref={earButton}
                aria-pressed={settings.listen}
                aria-expanded={asking}
                aria-controls={asking ? askId : undefined}
                onClick={toggleListen}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    d="M7.5 9.5a4.5 4.5 0 1 1 9 0c0 3.2-3.2 4-3.2 7.2a2.6 2.6 0 0 1-5.1.6M10.2 9.6a1.8 1.8 0 0 1 3.6 0c0 1.2-1 1.6-1.6 2.3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="room-listen-label">Escuchar</span>
              </button>
              {asking && (
                <div
                  id={askId}
                  role="dialog"
                  aria-labelledby={`${askId}-t`}
                  className="room-sheet room-ask"
                >
                  <h2 id={`${askId}-t`} className="room-shop-title">
                    Escuchar
                  </h2>
                  <p>
                    Patitas escucha para que tus cachorros reaccionen a palmadas y voces. El sonido
                    se analiza en el móvil y no se guarda ni se envía.
                  </p>
                  <div className="room-sheet-foot">
                    <button
                      type="button"
                      className="room-ask-yes"
                      onClick={() => {
                        setAsking(false)
                        onSettle({ listen: true, explained: true })
                      }}
                    >
                      Activar
                    </button>
                    <button type="button" onClick={() => closeAsk('escape')}>
                      Ahora no
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div ref={shop} className="room-wallet">
              <button
                type="button"
                className="room-coins"
                ref={shopButton}
                aria-expanded={shopOpen}
                aria-controls={shopOpen ? shopId : undefined}
                onClick={() => setShopOpen((o) => !o)}
              >
                <span className="room-coin" aria-hidden="true" />
                {wallet.coins}
                <span className="sr-only">
                  {' '}
                  {wallet.coins === 1 ? 'moneda' : 'monedas'} · Tienda
                </span>
                {gained && (
                  <span key={gained.n} className="room-gain" aria-hidden="true">
                    +{gained.coins}
                  </span>
                )}
              </button>
              <span role="status" className="sr-only">
                {gained && `+${gained.coins} monedas`}
              </span>
              {shopOpen && (
                <div id={shopId} className="room-sheet">
                  <Shop
                    wallet={wallet}
                    onBuy={onBuy}
                    onUse={onUse}
                    wearer={
                      wearer && {
                        name: wearer.name,
                        collar: wearer.collar ?? null,
                        alone: inRoom.length < 2,
                      }
                    }
                    onWear={(collar) => {
                      if (wearer) onWear(wearer.id, collar).catch(() => {})
                    }}
                  />
                </div>
              )}
            </div>
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
        {micLost && (
          <p role="alert" className="room-note">
            No se ha podido usar el micrófono. Revisa el permiso en el navegador.
          </p>
        )}
        {unsaved && <UnsavedNotice className="room-note" />}
        {inRoom.some((p) => unloaded.has(p.id)) && (
          <p role="alert" className="room-note">
            No se han podido cargar los cuidados.
          </p>
        )}
      </header>
      {learnt && (
        <p key={learnt.n} role="status" className="room-toast">
          {learnt.text}
        </p>
      )}
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
        toy={TOY_NAMES[wallet.toy]}
        treats={
          treats > 0 && (
            <button type="button" aria-label={`Chuche, quedan ${treats}`} onClick={giveTreat}>
              Chuche · {treats}
            </button>
          )
        }
        care={
          <CareActions
            selected={selected}
            idle={!status.needs.length}
            stage={stage}
            foods={foods}
            onFood={onSpend}
          />
        }
        mode={busy ? <CareMode needs={status.needs} stage={stage} /> : undefined}
        onOpen={onOpen}
      />
      {status.notice && <div className="room-loading">{status.notice}</div>}
    </div>
  )
}
