import type { Care, PlaceAccident } from '@/domain/care'
import type { Puppy } from '@/domain/puppy'
import type { CollarLook, Decor, ToyId } from '@/domain/shop'
import type { Deed } from '@/domain/wallet'
import type { PuppyNeeds, RoomStage, StageStatus, TrickPose } from '@/presentation/roomStage'
import type { PreviewStage, PreviewStatus } from '@/presentation/previewStage'
import { createMemoryStorage } from '@/infrastructure/memoryStorage'
import type { OpenMicrophone } from '@/infrastructure/microphone'
import type { GameStorage } from '@/infrastructure/storage'

/** A puppy's needs as a room would report them, `id` and `name` first. */
export const needs = (id: string, name: string, more: Partial<PuppyNeeds> = {}): PuppyNeeds => ({
  id,
  name,
  hunger: 0.3,
  energy: 0.8,
  cleanliness: 1,
  happiness: 0.5,
  weightKg: 5,
  bowl: 0,
  wet: 0,
  shine: 0,
  mode: null,
  bath: null,
  dryer: false,
  health: 'Bien',
  asleep: false,
  reading: null,
  weightStatus: null,
  ...more,
})

/**
 * A room with no 3D: it records what the screen asks of it, keeps the care each puppy came in
 * with and lets a test push status. `place`, when given, is where every accident lands.
 */
export function createFakeStage(place?: PlaceAccident) {
  const calls: string[] = []
  const canvases: HTMLCanvasElement[] = []
  const shown: Puppy[][] = []
  /** Each puppy the screen pointed out to the room, in order. */
  const selected: (number | null)[] = []
  /** Each toy the screen chose to throw, in order. */
  const toys: ToyId[] = []
  /** Each set of colours the screen gave the room, in order. */
  const decors: Decor[] = []
  /** The collar the screen last gave each puppy. */
  const collars = new Map<string, CollarLook | null>()
  /** The care each puppy came in with, in order of arrival. */
  const arrived: { id: string; care: Care }[] = []
  const held = new Map<string, Care>()
  const listeners = new Set<(s: StageStatus) => void>()
  const deedListeners = new Set<(d: Deed) => void>()
  /** What the next treat teaches: undefined when the puppy cannot take it. */
  let treatTeaches: TrickPose | null | undefined = null
  let status: StageStatus = {
    hint: 'Toca el suelo y irá hacia allí.',
    ball: { inHand: false, disabled: false },
    notice: null,
    needs: [],
    touched: null,
    cleaned: false,
  }
  const stage: RoomStage = {
    setPuppies(puppies, cares) {
      shown.push(puppies)
      for (const id of held.keys()) if (!puppies.some((p) => p.id === id)) held.delete(id)
      for (const p of puppies) {
        const care = cares?.get(p.id)
        if (!care || held.has(p.id)) continue
        held.set(p.id, care)
        arrived.push({ id: p.id, care })
      }
    },
    cares: () => new Map(held),
    placeAccidents: () => place,
    resume(cares, away) {
      calls.push(`resume:${away}`)
      for (const [id, care] of cares) if (held.has(id)) held.set(id, care)
    },
    takeBall: () => void calls.push('takeBall'),
    setToy: (toy) => void toys.push(toy),
    setDecor: (decor) => void decors.push(decor),
    setCollar: (id, collar) => void collars.set(id, collar),
    stowBall: () => void calls.push('stowBall'),
    trick: (index, pose) => void calls.push(`trick:${index}:${pose}`),
    treat(index) {
      calls.push(`treat:${index}`)
      return treatTeaches === undefined ? null : { taught: treatTeaches }
    },
    select: (index) => void selected.push(index),
    feed(index, food) {
      calls.push(food ? `feed:${index}:${food}` : `feed:${index}`)
      return true
    },
    bath: (index) => void calls.push(`bath:${index}`),
    rinse: () => void calls.push('rinse'),
    dryer: () => void calls.push('dryer'),
    finishBath: () => void calls.push('finishBath'),
    brush: (index) => void calls.push(`brush:${index}`),
    endBrush: () => void calls.push('endBrush'),
    weigh: (index) => void calls.push(`weigh:${index}`),
    hear: (kind) => void calls.push(`hear:${kind}`),
    onChange(listener) {
      listeners.add(listener)
      listener(status)
      return () => listeners.delete(listener)
    },
    onDeed(listener) {
      deedListeners.add(listener)
      return () => deedListeners.delete(listener)
    },
    dispose: () => void calls.push('dispose'),
  }
  return {
    calls,
    selected,
    toys,
    decors,
    collars,
    arrived,
    /** Changes the care the room keeps for a puppy, as time in it would. */
    hold: (id: string, care: Care) => void held.set(id, care),
    /** Every canvas a stage was created on, in order. */
    canvases,
    /** Names of the puppies the room shows now. */
    names: () => (shown.at(-1) ?? []).map((p) => p.name),
    emit(next: Partial<StageStatus>) {
      status = { ...status, ...next }
      for (const l of listeners) l(status)
    },
    /** What the next treats teach, or undefined for a puppy that cannot take one. */
    teaches: (trick: TrickPose | null | undefined) => void (treatTeaches = trick),
    /** The player does something in the room that earns coins. */
    deed: (d: Deed) => {
      for (const l of deedListeners) l(d)
    },
    create: (canvas: HTMLCanvasElement) => {
      canvases.push(canvas)
      return stage
    },
  }
}

/**
 * A microphone a test plays levels into, in dBFS, 20 ms apart; `refuse` makes the next opening
 * fail, as when the player says no.
 */
export function createFakeMic() {
  const opened: { level(db: number): void; stopped: boolean }[] = []
  let refusing = false
  const open: OpenMicrophone = async (onLevel) => {
    if (refusing) throw new DOMException('denied', 'NotAllowedError')
    const mic = {
      stopped: false,
      level: (db: number) => onLevel(db, 0.02),
      stop: () => void (mic.stopped = true),
    }
    opened.push(mic)
    return mic
  }
  return {
    open,
    opened,
    /** The microphone open now, if any. */
    live: () => opened.find((m) => !m.stopped),
    refuse: () => void (refusing = true),
  }
}

/** The in-memory storage, as if the browser could keep it. */
export const savingStorage = (): GameStorage => ({ ...createMemoryStorage(), persistent: true })

/** An adoption preview with no 3D: it records what it is asked and lets a test push status. */
export function createFakePreview() {
  const calls: string[] = []
  const canvases: HTMLCanvasElement[] = []
  const listeners = new Set<(s: PreviewStatus) => void>()
  let status: PreviewStatus = { loading: true, notice: null }
  return {
    calls,
    canvases,
    emit(next: Partial<PreviewStatus>) {
      status = { ...status, ...next }
      for (const l of listeners) l(status)
    },
    create: (canvas: HTMLCanvasElement): PreviewStage => {
      canvases.push(canvas)
      return {
        show: (id) => void calls.push(`show:${id}`),
        onStatus(listener) {
          listeners.add(listener)
          listener(status)
          return () => void listeners.delete(listener)
        },
        dispose: () => void calls.push('dispose'),
      }
    },
  }
}
