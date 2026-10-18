import { BREEDS } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'
import { ROOM_CAPACITY } from '@/domain/room'
import { endPet, movePet, pickHint, puzzle, startPet, type HintKey } from '@/engine/puppy/behaviour'
import {
  askTrick,
  hasPuppyGeometry,
  headWorld,
  hitPuppy,
  mountPuppyView,
  offerBall,
  pointLook,
  puppyGeometry,
  putBallAway,
  throwBall,
  tickPuppies,
  type PuppyView,
} from '@/engine/puppy/view'
import { createBall, stepBall, throwVelocity } from '@/engine/room/ball'
import { clampPlay } from '@/engine/room/camera'
import { attachPointer, rayHitsBall } from '@/engine/room/input'
import { goTo } from '@/engine/motion/locomotion'
import { createRoomScene, keepInPlay, syncBallMesh, type RoomScene } from '@/engine/room/scene'
import { HINTS } from './hints'
import type { RoomStage, StageStatus } from './roomStage'

/** Where each puppy starts, for one or two. */
const PLACES = [
  [{ x: 0, z: 0 }],
  [
    { x: -0.32, z: 0, heading: 0.25 },
    { x: 0.32, z: 0, heading: -0.25 },
  ],
]

const NO_3D = 'Este navegador no puede mostrar gráficos 3D.'
const IDLE_HAPPINESS = 0.25

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
        merged.ball.disabled === status.ball.disabled
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

/** The three.js room with the prototype's ball, petting, tricks and hints. */
export function createThreeStage(canvas: HTMLCanvasElement): RoomStage {
  const hub = statusHub({
    hint: HINTS.idle,
    happiness: IDLE_HAPPINESS,
    ball: { inHand: false, disabled: false },
    notice: null,
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
      onChange: hub.onChange,
      dispose: hub.clear,
    }
  }

  const ball = createBall()
  const mounted = new Map<string, PuppyView>()
  let wanted: Puppy[] = []
  let views: PuppyView[] = []
  let petView: PuppyView | null = null
  let hintNow: HintKey = 'idle'
  let meshing: ReturnType<typeof setTimeout> | undefined
  const now = () => performance.now() / 1000
  const free = () => views.every((v) => v.fetch.task === 'free')
  const mood = (v: PuppyView) => ({
    happy: v.behaviour.happy,
    energy: v.persona.energy,
    clamp: (x: number, z: number) => clampPlay(room.cam, x, z),
  })

  const order = () => {
    views = wanted.flatMap((p) => mounted.get(p.id) ?? [])
  }

  const mountWanted = () => {
    meshing = undefined
    const places = PLACES[wanted.length - 1] ?? []
    let added = false
    wanted.forEach((p, i) => {
      if (mounted.has(p.id)) return
      added = true
      const view = mountPuppyView(
        room,
        p,
        puppyGeometry(BREEDS[p.breedId]),
        room.quality,
        places[i],
      )
      mounted.set(p.id, view)
    })
    order()
    // A newcomer waits for the throw like the others
    if (added && ball.state === 'hand') offerBall(views, ball)
    hub.set({ notice: null })
  }

  const detach = attachPointer(canvas, room.camera, {
    hit: (ray) => hitPuppy(views, ray),
    ballInHand: () => ball.state === 'hand',
    onBall: (ray) => ball.state === 'air' && rayHitsBall(ray, ball.pos),
    free,
    petStart(hit, t) {
      petView = hit.view
      startPet(hit.view.behaviour, hit.zone, hit.point, t)
      if (hit.view.fetch.task === 'free') hit.view.motion.goal = null
    },
    petMove(hit, t, px) {
      if (hit.view !== petView) return
      if (movePet(hit.view.behaviour, hit.zone, hit.point, t, px)) room.emitHeart(hit.point)
    },
    petEnd() {
      if (petView) endPet(petView.behaviour)
      petView = null
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
          goTo(v.motion, g.x, g.z, mood(v))
          v.behaviour.perk = 1
        }
      else if (g.kind === 'puzzle') for (const v of views) puzzle(v.behaviour)
    },
  })
  const offResize = room.onResize(() => {
    for (const v of views) keepInPlay(v.motion, room.cam, mood(v))
  })

  room.start((dt, t) => {
    stepBall(ball, room.cam, dt)
    syncBallMesh(room, ball)
    tickPuppies(views, { room, ball, now: now(), petting: petView }, dt, t).forEach((ev, i) => {
      if (!ev.dropped) return
      const at = headWorld(views[i]!)
      for (let n = 0; n < 3; n++) room.emitHeart(at)
    })
    syncBallMesh(room, ball)
    // The hint and the ball button follow whichever puppy is playing
    const v = views.find((w) => w.fetch.task !== 'free') ?? views[0]
    if (!v) {
      hintNow = 'idle'
      hub.set({
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
      for (const [id, view] of mounted) {
        if (wanted.some((p) => p.id === id)) continue
        // A puppy leaving with the ball in its mouth takes it out of play
        if (view.fetch.holding) ball.state = 'none'
        if (view === petView) petView = null
        view.dispose()
        mounted.delete(id)
      }
      order()
      if (!views.length) putBallAway(views, ball)
      const slow = wanted.filter((p) => !mounted.has(p.id) && !hasPuppyGeometry(p.breedId))
      clearTimeout(meshing)
      if (!slow.length) return mountWanted()
      // Meshing blocks the page for a couple of seconds: let the notice paint first
      hub.set({ notice: `Preparando a ${slow.map((p) => p.name).join(' y ')}…` })
      meshing = setTimeout(mountWanted, 40)
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
    onChange: hub.onChange,
    dispose() {
      clearTimeout(meshing)
      hub.clear()
      detach()
      offResize()
      for (const v of mounted.values()) v.dispose()
      mounted.clear()
      room.dispose()
    },
  }
}
