import { BREEDS } from '@/domain/breeds'
import { cleanMess, createCare, isNight } from '@/domain/care'
import type { Puppy } from '@/domain/puppy'
import { ROOM_CAPACITY } from '@/domain/room'
import type { Vec3 } from '@/engine/math'
import { endPet, movePet, pickHint, puzzle, startPet, type HintKey } from '@/engine/puppy/behaviour'
import {
  askTrick,
  bathe,
  finishBath,
  headWorld,
  hitPuppy,
  liftBath,
  mountPuppyView,
  offerBall,
  pointLook,
  putBallAway,
  rubBath,
  throwBall,
  tickPuppies,
  type PuppyView,
} from '@/engine/puppy/view'
import { loadPuppyGeometry, peekPuppyGeometry } from '@/engine/puppy/geometryClient'
import { createBall, stepBall, throwVelocity } from '@/engine/room/ball'
import { createBathLayer, rinse, takeDryer } from '@/engine/room/bath'
import { clampPlay } from '@/engine/room/camera'
import { attachPointer, rayHitsBall } from '@/engine/room/input'
import { goTo } from '@/engine/motion/locomotion'
import {
  bedSlots,
  followBed,
  forgetRoute,
  goToMud,
  keepsEating,
  relieveNow,
  touch,
  tuckIn,
} from '@/engine/motion/routine'
import { START_PLACES } from '@/engine/room/furniture'
import { createMessLayer } from '@/engine/room/messes'
import { createRoomScene, keepInPlay, syncBallMesh, type RoomScene } from '@/engine/room/scene'
import { HINTS } from './hints'
import { NO_3D, type PuppyNeeds, type RoomStage, type StageStatus } from './roomStage'

const IDLE_HAPPINESS = 0.25

const hundredths = (x: number) => Math.round(x * 100) / 100

const needsOf = (v: PuppyView): PuppyNeeds => ({
  name: v.puppy.name,
  hunger: hundredths(v.care.hunger),
  energy: hundredths(v.care.energy),
  cleanliness: hundredths(v.care.cleanliness),
  happiness: hundredths(v.care.happiness),
  weightKg: hundredths(v.care.weightKg),
  bowl: hundredths(v.bowl),
  wet: hundredths(v.care.wet),
})

const sameNeeds = (a: PuppyNeeds[], b: PuppyNeeds[]) =>
  a.length === b.length &&
  a.every((n, i) => (Object.keys(n) as (keyof PuppyNeeds)[]).every((k) => n[k] === b[i]![k]))

function statusHub(initial: StageStatus) {
  let status = initial
  const listeners = new Set<(s: StageStatus) => void>()
  return {
    get: () => status,
    set(next: Partial<StageStatus>) {
      const merged = { ...status, ...next }
      if (
        merged.hint === status.hint &&
        merged.happiness === status.happiness &&
        merged.notice === status.notice &&
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
    happiness: IDLE_HAPPINESS,
    ball: { inHand: false, disabled: false },
    notice: null,
    needs: [],
  })
  let room: RoomScene
  try {
    room = createRoomScene(canvas)
  } catch {
    hub.set({ notice: NO_3D })
    return {
      setPuppies() {},
      takeBall() {},
      stowBall() {},
      trick() {},
      feed() {},
      bath() {},
      rinse() {},
      dryer() {},
      finishBath() {},
      onChange: hub.onChange,
      dispose: hub.clear,
    }
  }

  const ball = createBall()
  const messes = createMessLayer(room.scene)
  const baths = createBathLayer(room.scene)
  const mounted = new Map<string, PuppyView>()
  /** Puppies whose mesh failed to build, until the next setPuppies tries again. */
  const failed = new Set<string>()
  let wanted: Puppy[] = []
  let views: PuppyView[] = []
  let petView: PuppyView | null = null
  let hintNow: HintKey = 'idle'
  let disposed = false
  const now = () => performance.now() / 1000
  const free = () => views.every((v) => v.fetch.task === 'free')
  /** The puppy in its bath, if any: one at a time. */
  const inBath = () => views.find((v) => v.bath.phase !== 'off')
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

  /** Each puppy's place in the room is its place in `wanted`: its bed and bowl. */
  const order = () => {
    views = wanted.flatMap((p, i) => {
      const v = mounted.get(p.id)
      if (!v) return []
      v.place = i
      return [v]
    })
    if (room.furnish(wanted.length > 1 ? 2 : 1))
      for (const v of views) forgetRoute(v.routine, v.motion)
    followBeds()
  }

  /** Mounts every wanted puppy whose mesh is ready; a mesh for a puppy no longer wanted waits unused. */
  const mountReady = () => {
    if (disposed) return
    const spots = room.furniture?.spots
    const beds = spots && isNight(clock()) ? bedSlots(spots) : null
    const places = beds ?? START_PLACES[wanted.length - 1] ?? []
    let added = false
    wanted.forEach((p, i) => {
      if (mounted.has(p.id)) return
      const built = peekPuppyGeometry(p.breedId)
      if (!built) return
      added = true
      const care = createCare(BREEDS[p.breedId], clock())
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
      if (hit.bathZone) return rubBath(hit.view, hit.bathZone, hit.point)
      petView = hit.view
      touch(hit.view.routine)
      startPet(hit.view.behaviour, hit.zone, hit.point, t)
      if (hit.view.fetch.task === 'free') hit.view.motion.goal = null
    },
    petMove(hit, t, px) {
      if (hit.bathZone) return rubBath(hit.view, hit.bathZone, hit.point)
      for (const v of views) liftBath(v)
      if (hit.view !== petView) return
      if (movePet(hit.view.behaviour, hit.zone, hit.point, t, px)) room.emitHeart(hit.point)
    },
    // Off the puppy the scrubbing or drying stops and the dryer is put away
    petOff() {
      for (const v of views) liftBath(v)
    },
    petEnd() {
      if (petView) endPet(petView.behaviour)
      petView = null
      for (const v of views) liftBath(v)
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
      else if (g.kind === 'goTo')
        for (const v of views) {
          if (touch(v.routine) || v.routine.bath || keepsEating(v.routine, v.care)) continue
          goTo(v.motion, g.x, g.z, mood(v))
          v.behaviour.perk = 1
        }
      else if (g.kind === 'puzzle') for (const v of views) puzzle(v.behaviour)
    },
    // A tap on a mess cleans it up rather than calling the puppies there
    tap(x, y, w, h) {
      const mess = messes.hit(room.camera, x, y, w, h)
      if (!mess) return false
      for (const v of views) v.care = cleanMess(v.care, mess)
      return true
    },
  })
  // The beds move with the frame
  const offResize = room.onResize(() => {
    followBeds()
    messes.relayout(room.cam)
    for (const v of views) keepInPlay(v.motion, room.cam, mood(v))
  })

  room.start((dt, t) => {
    stepBall(ball, room.cam, dt)
    syncBallMesh(room, ball)
    tickPuppies(
      views,
      { room, ball, now: now(), petting: petView, clock: clock(), underfoot: messes.underfoot },
      dt,
      t,
    ).forEach((ev, i) => {
      if (!ev.dropped) return
      const at = headWorld(views[i]!)
      for (let n = 0; n < 3; n++) room.emitHeart(at)
    })
    baths.sync(views, dt, room.camera.position)
    messes.begin()
    for (const v of views) for (const m of v.care.messes) messes.show(m, room.cam)
    messes.end()
    messes.step(dt)
    syncBallMesh(room, ball)
    // The hint and the ball button follow whichever puppy is playing
    const v = views.find((w) => w.fetch.task !== 'free') ?? views[0]
    const needs = views.map(needsOf)
    if (!v) {
      hintNow = 'idle'
      hub.set({
        needs,
        hint: '',
        happiness: IDLE_HAPPINESS,
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
    hub.set({
      needs,
      hint: HINTS[hintNow],
      happiness: Math.round(s.happy * 100) / 100,
      ball: {
        inHand: ball.state === 'hand',
        disabled: v.fetch.task !== 'free' && v.fetch.task !== 'wait',
      },
    })
  })

  return {
    setPuppies(puppies) {
      wanted = puppies.slice(0, ROOM_CAPACITY)
      failed.clear()
      for (const [id, view] of mounted) {
        if (wanted.some((p) => p.id === id)) continue
        // A puppy leaving with the ball in its mouth takes it out of play
        if (view.fetch.holding) ball.state = 'none'
        if (view === petView) petView = null
        view.dispose()
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
    takeBall() {
      if (views.length && ball.state !== 'hand' && free()) offerBall(views, ball)
    },
    stowBall() {
      if (ball.state === 'hand') putBallAway(views, ball)
    },
    trick(pose) {
      for (const v of views) askTrick(v, pose)
    },
    feed() {
      for (const v of views) v.bowl = 1
    },
    bath(index) {
      const v = views[index]
      if (v && !inBath()) bathe(v)
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
      if (v) finishBath(v)
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
    dispose() {
      disposed = true
      hub.clear()
      detach()
      offResize()
      messes.dispose()
      baths.dispose()
      for (const v of mounted.values()) v.dispose()
      mounted.clear()
      room.dispose()
    },
  }
}
