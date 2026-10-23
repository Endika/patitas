import { BREEDS } from '@/domain/breeds'
import { cleanMess, createCare, eatTreat, health, isNight, type Care } from '@/domain/care'
import { knows, teach, type Puppy, type Trick } from '@/domain/puppy'
import { STANDARD_DECOR } from '@/domain/shop'
import type { Deed } from '@/domain/wallet'
import { ROOM_CAPACITY } from '@/domain/room'
import type { Vec3 } from '@/engine/math'
import { endPet, movePet, pickHint, puzzle, startPet, type HintKey } from '@/engine/puppy/behaviour'
import {
  askTrick,
  bathe,
  brushPuppy,
  callOver,
  dropFetch,
  finishBath,
  headWorld,
  hitPuppy,
  liftCoat,
  mountPuppyView,
  offerBall,
  pointLook,
  putBallAway,
  putToBed,
  rebed,
  rubCoat,
  showCare,
  stopBrushing,
  throwBall,
  tickPuppies,
  weighPuppy,
  type PuppyView,
} from '@/engine/puppy/view'
import { loadPuppyGeometry, peekPuppyGeometry } from '@/engine/puppy/geometryClient'
import { createBall, stepBall, throwVelocity } from '@/engine/room/ball'
import { createBathLayer, rinse, takeDryer } from '@/engine/room/bath'
import { createBrushLayer } from '@/engine/room/brush'
import { clampPlay } from '@/engine/room/camera'
import { attachPointer, rayHitsBall } from '@/engine/room/input'
import {
  bedSlots,
  followBed,
  forgetMovedRoute,
  forgetRoute,
  goToMud,
  relieveNow,
  routePlaces,
  touch,
  tuckIn,
  weighing,
  type RoutePlaces,
} from '@/engine/motion/routine'
import {
  computeSpots,
  createScaleDisplay,
  formatKg,
  showScale,
  startPlaces,
} from '@/engine/room/furniture'
import { createMessLayer, placeAccident } from '@/engine/room/messes'
import { createSelectRing, syncRing } from '@/engine/room/selectRing'
import { createRoomScene, keepInPlay, syncBallMesh, type RoomScene } from '@/engine/room/scene'
import { HINTS, hintText, NIGHT_HINT } from './hints'
import { needsBeat } from './needsBeat'
import {
  NO_3D,
  type BathStep,
  type CareMode,
  type PuppyNeeds,
  type RoomStage,
  type StageStatus,
} from './roomStage'

/** Hidden this long at night, milliseconds, the puppies are found asleep in their beds. */
const ASLEEP_AWAY = 10 * 60_000
/** Seconds «¡Limpio!» stays up after a mess is cleaned. */
const CLEANED_TIME = 1.2
/** Seconds a trick it has yet to learn takes to come, after a puzzled look. */
const TRICK_DOUBT = 1.2
/** Seconds after a trick a treat still teaches it. */
const TREAT_AFTER = 6
/** Happiness a treat brings at once. */
const TREAT_JOY = 0.15
/** Shine a brushing must add to earn coins. */
const BRUSHED_SHINE = 0.2

const hundredths = (x: number) => Math.round(x * 100) / 100

const modeOf = (v: PuppyView): CareMode | null =>
  v.bath.phase !== 'off' ? 'bath' : v.brush.on ? 'brush' : weighing(v.routine) ? 'weigh' : null

const bathStep = (v: PuppyView): BathStep | null =>
  v.bath.phase === 'off' ? null : v.bath.phase === 'scrub' ? 'scrub' : 'rinsed'

const asleep = (v: PuppyView) => v.routine.routine === 'sleeping'

const needsOf = (v: PuppyView): PuppyNeeds => ({
  id: v.puppy.id,
  name: v.puppy.name,
  hunger: hundredths(v.care.hunger),
  energy: hundredths(v.care.energy),
  cleanliness: hundredths(v.care.cleanliness),
  happiness: hundredths(v.care.happiness),
  weightKg: hundredths(v.care.weightKg),
  bowl: hundredths(v.bowl),
  wet: hundredths(v.care.wet),
  shine: hundredths(v.care.shine),
  mode: modeOf(v),
  bath: bathStep(v),
  dryer: v.bath.dryer,
  health: health(v.care, v.breed),
  asleep: asleep(v),
  reading: v.weighed && formatKg(v.weighed.kg),
  weightStatus: v.weighed?.status ?? null,
})

const sameNeeds = (a: PuppyNeeds[], b: PuppyNeeds[]) =>
  a === b ||
  (a.length === b.length &&
    a.every((n, i) => (Object.keys(n) as (keyof PuppyNeeds)[]).every((k) => n[k] === b[i]![k])))

/** What the care bar follows is as `told`. */
const sameBar = (told: PuppyNeeds, v: PuppyView) =>
  told.id === v.puppy.id &&
  told.mode === modeOf(v) &&
  told.bath === bathStep(v) &&
  told.dryer === v.bath.dryer &&
  told.asleep === asleep(v) &&
  !told.reading === !v.weighed

function statusHub(initial: StageStatus) {
  let status = initial
  const listeners = new Set<(s: StageStatus) => void>()
  return {
    get: () => status,
    set(next: Partial<StageStatus>) {
      const merged = { ...status, ...next }
      if (
        merged.hint === status.hint &&
        merged.notice === status.notice &&
        merged.cleaned === status.cleaned &&
        merged.touched?.count === status.touched?.count &&
        merged.ball.inHand === status.ball.inHand &&
        merged.ball.disabled === status.ball.disabled &&
        sameNeeds(merged.needs, status.needs)
      )
        return
      status = merged
      for (const l of listeners) l(status)
    },
    onChange(listener: (s: StageStatus) => void) {
      listeners.add(listener)
      listener(status)
      return () => void listeners.delete(listener)
    },
    clear: () => listeners.clear(),
  }
}

/**
 * The three.js room with the prototype's ball, petting, tricks and hints, and the puppies' own
 * routines on the wall `clock` (milliseconds): opened at night, they are already in bed.
 */
export function createThreeStage(
  canvas: HTMLCanvasElement,
  clock: () => number = Date.now,
): RoomStage {
  const hub = statusHub({
    hint: HINTS.idle,
    ball: { inHand: false, disabled: false },
    notice: null,
    needs: [],
    touched: null,
    cleaned: false,
  })
  let room: RoomScene
  try {
    room = createRoomScene(canvas)
  } catch {
    hub.set({ notice: NO_3D })
    return {
      setPuppies() {},
      cares: () => new Map(),
      placeAccidents: () => undefined,
      resume() {},
      takeBall() {},
      setToy() {},
      setDecor() {},
      stowBall() {},
      trick() {},
      treat: () => null,
      select() {},
      feed: () => false,
      bath() {},
      rinse() {},
      dryer() {},
      finishBath() {},
      brush() {},
      endBrush() {},
      weigh() {},
      onChange: hub.onChange,
      onDeed: () => () => {},
      dispose: hub.clear,
    }
  }

  const ball = createBall()
  /** The toy the player chose, swapped in once the one in play is back. */
  let toy = ball.toy
  /** The colours chosen for the room: furniture laid out anew is painted in them too. */
  let decor = STANDARD_DECOR
  const messes = createMessLayer(room.scene)
  const baths = createBathLayer(room.scene)
  const brushes = createBrushLayer(room.scene)
  const ring = createSelectRing(room.scene)
  /** The index the buttons and floor taps are for, as the screen last said. */
  let chosen: number | null = null
  const scaleDisplay = createScaleDisplay()
  const mounted = new Map<string, PuppyView>()
  /** Puppies whose mesh failed to build, until the next setPuppies tries again. */
  const failed = new Set<string>()
  let wanted: Puppy[] = []
  /** The care each puppy coming in starts from, until it is mounted. */
  const incoming = new Map<string, Care>()
  let views: PuppyView[] = []
  let petView: PuppyView | null = null
  let hintNow: HintKey = 'idle'
  const beat = needsBeat(needsOf, sameBar)
  let cleanT = 0
  let touches = 0
  let disposed = false
  const deedListeners = new Set<(deed: Deed) => void>()
  const did = (deed: Deed) => {
    for (const l of deedListeners) l(deed)
  }
  /** The shine of the puppy being brushed when the brush came out. */
  let shineWas = 0
  /** Tricks asked of puppies that do not know them well yet, with the seconds left to come. */
  const asked = new Map<PuppyView, { pose: Trick; left: number }>()
  /** Each puppy's last trick, and when, on the pointer clock. */
  const lastTrick = new Map<PuppyView, { pose: Trick; at: number }>()
  const doTrick = (v: PuppyView, pose: Trick) => {
    if (!askTrick(v, pose)) return
    lastTrick.set(v, { pose, at: now() })
    did('trick')
  }
  const now = () => performance.now() / 1000
  const free = () => views.every((v) => v.fetch.task === 'free')
  /** The puppy in its bath, if any: one at a time. */
  const inBath = () => views.find((v) => v.bath.phase !== 'off')
  /** The puppy being brushed, if any: one at a time, and not while another is bathed. */
  const brushed = () => views.find((v) => v.brush.on)
  const mood = (v: PuppyView) => ({
    happy: v.behaviour.happy,
    energy: v.persona.energy,
    clamp: (x: number, z: number) => clampPlay(room.cam, x, z),
  })

  /** Where each puppy's bed stood when last looked. */
  const bedAt = new Map<PuppyView, Vec3>()
  /** Whoever is in its bed or on the way there moves along with it. */
  const followBeds = () => {
    const beds = room.furniture?.spots.beds
    if (!beds) return
    for (const v of views) {
      const bed = beds[v.place]?.center
      if (!bed) continue
      const was = bedAt.get(v)
      bedAt.set(v, bed.clone())
      if (!was) continue
      followBed(
        v.routine,
        [v.motion.pos, ...v.legs.flatMap((L) => [L.planted, L.from, L.land, L.pos])],
        bed.x - was.x,
        bed.z - was.z,
      )
    }
  }

  /** Where the bowls, the scale, the mud and the garden stood when last looked. */
  let placesWere: RoutePlaces | null = null
  const placesNow = () => {
    const s = room.furniture?.spots
    return s ? routePlaces(s) : null
  }
  /** Each puppy's place in the room is its place in `wanted`: its bed and bowl. */
  const order = () => {
    views = wanted.flatMap((p, i) => {
      const v = mounted.get(p.id)
      if (!v) return []
      v.place = i
      return [v]
    })
    const refurnished = room.furnish(wanted.length > 1 ? 2 : 1)
    if (refurnished) room.furniture?.setDecor(decor)
    if (refurnished) for (const v of views) forgetRoute(v.routine, v.motion)
    placesWere = placesNow()
    followBeds()
    if (refurnished && room.furniture) rebed(views, room.furniture.spots, ball)
  }

  /** Mounts every wanted puppy whose mesh is ready; a mesh for a puppy no longer wanted waits unused. */
  const mountReady = () => {
    if (disposed) return
    const spots = room.furniture?.spots
    const beds = spots && isNight(clock()) ? bedSlots(spots) : null
    const places = beds ?? startPlaces(room.cam, spots ?? null, wanted.length > 1 ? 2 : 1)
    let added = false
    wanted.forEach((p, i) => {
      if (mounted.has(p.id)) return
      const built = peekPuppyGeometry(p.breedId)
      if (!built) return
      added = true
      const care = incoming.get(p.id) ?? createCare(BREEDS[p.breedId], clock())
      incoming.delete(p.id)
      const view = mountPuppyView(room, p, built, room.quality, places[i], care)
      const bed = beds?.[i]
      if (bed) tuckIn(view.routine, view.motion, bed.side)
      mounted.set(p.id, view)
    })
    order()
    // A newcomer waits for the throw like the others
    if (added && ball.state === 'hand') offerBall(views, ball)
    showNotice()
  }

  const names = (ps: Puppy[]) => ps.map((p) => p.name).join(' y ')
  const showNotice = () => {
    const lost = wanted.filter((p) => failed.has(p.id) && !mounted.has(p.id))
    const waiting = wanted.filter((p) => !failed.has(p.id) && !mounted.has(p.id))
    hub.set({
      notice: lost.length
        ? `No se pudo preparar a ${names(lost)}.`
        : waiting.length
          ? `Preparando a ${names(waiting)}…`
          : null,
    })
  }

  const detach = attachPointer(canvas, room.camera, {
    hit: (ray) => hitPuppy(views, ray),
    ballInHand: () => ball.state === 'hand',
    onBall: (ray) => ball.state === 'air' && rayHitsBall(ray, ball.pos),
    free,
    petStart(hit, t) {
      if (hit.bathZone) return rubCoat(hit.view, hit.bathZone, hit.point)
      petView = hit.view
      hub.set({ touched: { id: hit.view.puppy.id, count: ++touches } })
      touch(hit.view.routine)
      startPet(hit.view.behaviour, hit.zone, hit.point, t)
      if (hit.view.fetch.task === 'free') hit.view.motion.goal = null
    },
    petMove(hit, t, px) {
      if (hit.bathZone) return rubCoat(hit.view, hit.bathZone, hit.point)
      for (const v of views) liftCoat(v)
      if (hit.view !== petView) return
      if (movePet(hit.view.behaviour, hit.zone, hit.point, t, px)) room.emitHeart(hit.point)
    },
    // Off the puppy the scrubbing or drying stops and the dryer is put away
    petOff() {
      for (const v of views) liftCoat(v)
    },
    petEnd() {
      if (petView) endPet(petView.behaviour)
      petView = null
      for (const v of views) liftCoat(v)
    },
    look(ray, t) {
      for (const v of views) pointLook(v, ray, room.camera, t)
    },
    leave(t) {
      for (const v of views) v.behaviour.pointerAt = t - 1.2
    },
    gesture(g) {
      if (!views.length) return
      if (g.kind === 'throw') {
        const vel = throwVelocity(room.cam, g.swipe)
        if (vel) throwBall(views, ball, vel)
      } else if (g.kind === 'takeBall') offerBall(views, ball)
      else if (g.kind === 'goTo') callOver(views, chosen ?? 0, g.x, g.z, mood)
      else if (g.kind === 'puzzle') for (const v of views) puzzle(v.behaviour)
    },
    // A tap on a mess cleans it up rather than calling the puppies there
    tap(x, y, w, h) {
      const mess = messes.hit(room.camera, x, y, w, h)
      if (!mess) return false
      for (const v of views) v.care = cleanMess(v.care, mess)
      cleanT = CLEANED_TIME
      did('clean')
      return true
    },
    tapsAt: (x, y, w, h) => !!messes.hit(room.camera, x, y, w, h),
  })
  // The beds move with the frame, and one whose own bowl, mud, garden or scale moved (on its way
  // there, eating or weighed) chooses again where that now is
  const offResize = room.onResize(() => {
    const now = placesNow()
    for (const v of views) forgetMovedRoute(v.routine, v.motion, placesWere, now, v.place)
    placesWere = now
    followBeds()
    messes.relayout(room.cam)
    for (const v of views) keepInPlay(v.motion, room.cam, mood(v))
  })

  room.start((dt, t) => {
    if (ball.toy !== toy && (ball.state === 'none' || ball.state === 'hand')) ball.toy = toy
    stepBall(ball, room.cam, dt)
    syncBallMesh(room, ball)
    for (const [v, ask] of asked) {
      ask.left -= dt
      if (ask.left > 0) continue
      asked.delete(v)
      if (views.includes(v)) doTrick(v, ask.pose)
    }
    tickPuppies(
      views,
      { room, ball, now: now(), petting: petView, clock: clock(), underfoot: messes.underfoot },
      dt,
      t,
    ).forEach((ev, i) => {
      if (ev.fed) did('meal')
      if (!ev.dropped) return
      did('fetch')
      const at = headWorld(views[i]!)
      for (let n = 0; n < 3; n++) room.emitHeart(at)
    })
    baths.sync(views, dt, room.camera.position)
    brushes.sync(views, dt, room.camera)
    syncRing(ring, views, chosen)
    const onScale = views.find((w) => w.routine.routine === 'onScale')
    showScale(
      scaleDisplay,
      room.furniture,
      onScale ? onScale.care.weightKg : null,
      views.some((w) => weighing(w.routine)),
      dt,
    )
    messes.begin()
    for (const v of views) for (const m of v.care.messes) messes.show(m, room.cam)
    messes.end()
    messes.step(dt)
    syncBallMesh(room, ball)
    // The hint and the ball button follow whichever puppy is playing
    const v = views.find((w) => w.fetch.task !== 'free') ?? views[0]
    const needs = beat(views, dt)
    cleanT = Math.max(0, cleanT - dt)
    const cleaned = cleanT > 0
    if (!v) {
      hintNow = 'idle'
      hub.set({
        needs,
        cleaned,
        hint: '',
        ball: { inHand: ball.state === 'hand', disabled: true },
      })
      return
    }
    const s = v.behaviour
    const zone = v === petView && now() - s.petLast < 0.35 ? s.zone : null
    hintNow = pickHint(hintNow, {
      fetch: v.fetch,
      motion: v.motion,
      zone,
      scratch: s.scratch,
      sincePet: now() - s.petLast,
    })
    const night = isNight(clock()) && views.every(asleep)
    hub.set({
      needs,
      cleaned,
      hint: night ? NIGHT_HINT : hintText(hintNow, v.puppy.name),
      ball: {
        inHand: ball.state === 'hand',
        disabled: v.fetch.task !== 'free' && v.fetch.task !== 'wait',
      },
    })
  })

  return {
    setPuppies(puppies, cares) {
      wanted = puppies.slice(0, ROOM_CAPACITY)
      failed.clear()
      for (const id of incoming.keys()) if (!wanted.some((p) => p.id === id)) incoming.delete(id)
      for (const p of wanted) {
        const care = cares?.get(p.id)
        if (care && !mounted.has(p.id)) incoming.set(p.id, care)
      }
      for (const [id, view] of mounted) {
        if (wanted.some((p) => p.id === id)) continue
        // A puppy leaving with the ball in its mouth takes it out of play
        if (view.fetch.holding) ball.state = 'none'
        if (view === petView) petView = null
        view.dispose()
        asked.delete(view)
        lastTrick.delete(view)
        mounted.delete(id)
        bedAt.delete(view)
      }
      order()
      if (!views.length) putBallAway(views, ball)
      mountReady()
      for (const p of wanted)
        if (!mounted.has(p.id))
          void loadPuppyGeometry(p.breedId).then(mountReady, () => {
            // The cache forgets a failed build, so the next setPuppies tries again
            if (disposed) return
            failed.add(p.id)
            showNotice()
          })
    },
    cares() {
      const all = new Map(incoming)
      for (const v of views) all.set(v.puppy.id, v.care)
      return all
    },
    placeAccidents(count) {
      if (!room.furniture) return undefined
      const there = [...incoming.values(), ...views.map((v) => v.care)].flatMap((c) => c.messes)
      const puppies = count > 1 ? 2 : 1
      // The room as it stands, when it is laid out for as many
      const spots =
        room.furniture.puppies === puppies ? room.furniture.spots : computeSpots(room.cam, puppies)
      return placeAccident(room.cam, spots, undefined, there)
    },
    resume(cares, away) {
      const spots = room.furniture?.spots
      const beds = spots && away >= ASLEEP_AWAY && isNight(clock()) ? bedSlots(spots) : null
      for (const [id, care] of cares) {
        if (incoming.has(id)) incoming.set(id, care)
        const v = mounted.get(id)
        if (!v) continue
        showCare(v, care)
        const bed = beds?.[v.place]
        if (bed && !asleep(v)) putToBed(v, bed, ball)
      }
      if (beds && ball.state === 'hand') putBallAway(views, ball)
    },
    takeBall() {
      if (views.length && ball.state !== 'hand' && free()) offerBall(views, ball)
    },
    setToy(next) {
      toy = next
    },
    setDecor(next) {
      decor = next
      room.furniture?.setDecor(decor)
    },
    stowBall() {
      if (ball.state === 'hand') putBallAway(views, ball)
    },
    trick(index, pose) {
      const v = views[index]
      if (!v) return
      const doubt = TRICK_DOUBT * (1 - knows(v.puppy, pose))
      if (doubt <= 0) return doTrick(v, pose)
      if (!asleep(v)) puzzle(v.behaviour)
      asked.set(v, { pose, left: doubt })
    },
    treat(index) {
      const v = views[index]
      if (!v || asleep(v) || v.routine.held) return null
      v.care = eatTreat(v.care, v.breed)
      v.behaviour.happy = Math.min(1, v.behaviour.happy + TREAT_JOY)
      v.behaviour.perk = 1
      const at = headWorld(v)
      for (let n = 0; n < 2; n++) room.emitHeart(at)
      const last = lastTrick.get(v)
      if (!last || now() - last.at > TREAT_AFTER) return { taught: null }
      lastTrick.delete(v)
      v.puppy = teach(v.puppy, last.pose)
      return { taught: last.pose }
    },
    select(index) {
      chosen = index
    },
    feed(index, food) {
      let fed = false
      for (const [i, v] of views.entries())
        if (index === undefined || i === index) {
          v.bowl = 1
          v.food = food ?? null
          fed = true
        }
      return fed
    },
    bath(index) {
      const v = views[index]
      if (!v || inBath() || brushed()) return
      if (ball.state === 'hand') putBallAway(views, ball)
      if (v.fetch.task !== 'free' && v.fetch.task !== 'wait') dropFetch(v, ball)
      bathe(v)
    },
    rinse() {
      const v = inBath()
      if (v) rinse(v.bath)
    },
    dryer() {
      const v = inBath()
      if (v) takeDryer(v.bath)
    },
    finishBath() {
      const v = inBath()
      if (!v) return
      // Only a bath taken as far as the rinse counts
      if (v.bath.phase !== 'scrub') did('bath')
      finishBath(v)
    },
    brush(index) {
      const v = views[index]
      if (!v || inBath() || brushed()) return
      shineWas = v.care.shine
      brushPuppy(v)
    },
    endBrush() {
      const v = brushed()
      if (!v) return
      if (v.care.shine - shineWas >= BRUSHED_SHINE) did('brush')
      stopBrushing(v)
    },
    weigh(index) {
      const v = views[index]
      if (v && room.furniture && !views.some((w) => weighing(w.routine))) weighPuppy(v)
    },
    toMud() {
      const v = views[0],
        spots = room.furniture?.spots
      if (!v || !spots || v.routine.routine !== 'none' || v.fetch.task !== 'free') return
      goToMud(v.routine, v.motion, spots, (x, z) => clampPlay(room.cam, x, z))
    },
    relieve(kind) {
      const v = views[0]
      if (!v || v.routine.routine !== 'none' || v.fetch.task !== 'free') return
      relieveNow(v.routine, v.motion, kind)
    },
    onChange: hub.onChange,
    onDeed(listener) {
      deedListeners.add(listener)
      return () => void deedListeners.delete(listener)
    },
    dispose() {
      disposed = true
      hub.clear()
      deedListeners.clear()
      detach()
      offResize()
      messes.dispose()
      baths.dispose()
      brushes.dispose()
      ring.dispose()
      for (const v of mounted.values()) v.dispose()
      mounted.clear()
      room.dispose()
    },
  }
}
