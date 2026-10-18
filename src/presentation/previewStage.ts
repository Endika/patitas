import { BREEDS, type BreedId } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'
import { endPet, movePet, startPet } from '@/engine/puppy/behaviour'
import { loadPuppyGeometry, peekPuppyGeometry } from '@/engine/puppy/geometryClient'
import {
  hitZone,
  mountPuppyView,
  pointLook,
  tickPuppies,
  type PuppyView,
} from '@/engine/puppy/view'
import { createBall } from '@/engine/room/ball'
import { attachPointer } from '@/engine/room/input'
import { createRoomScene, syncBallMesh, type RoomScene } from '@/engine/room/scene'
import { createBreedSwitch } from './breedSwitch'
import { NO_3D } from './roomStage'

export interface PreviewStatus {
  loading: boolean
  /** Shown instead of the puppy: it could not be built, or there is no 3D at all. */
  notice: string | null
}

/** The breed preview on the adoption screen: one puppy to stroke, no ball and no tricks. */
export interface PreviewStage {
  /** Replaces the puppy shown with one of this breed. */
  show(id: BreedId): void
  /** Called at once with the current status and again whenever it changes. */
  onStatus(listener: (s: PreviewStatus) => void): () => void
  dispose(): void
}

const FAILED = 'No se pudo preparar al cachorro.'

/** A stand-in that is never saved: the breed's own persona, named after the breed. */
const previewPuppy = (id: BreedId): Puppy => ({
  id: `preview-${id}`,
  name: BREEDS[id].label,
  breedId: id,
  persona: BREEDS[id].defaultPersona,
  adoptedAt: 0,
})

function statusHub(initial: PreviewStatus) {
  let status = initial
  const listeners = new Set<(s: PreviewStatus) => void>()
  return {
    set(next: PreviewStatus) {
      if (next.loading === status.loading && next.notice === status.notice) return
      status = next
      for (const l of listeners) l(status)
    },
    onStatus(listener: (s: PreviewStatus) => void) {
      listeners.add(listener)
      listener(status)
      return () => void listeners.delete(listener)
    },
    clear: () => listeners.clear(),
  }
}

/** The room's scene and petting with a single puppy that stays where it is. */
export function createThreePreviewStage(canvas: HTMLCanvasElement): PreviewStage {
  const hub = statusHub({ loading: true, notice: null })
  let room: RoomScene
  try {
    room = createRoomScene(canvas)
  } catch {
    hub.set({ loading: false, notice: NO_3D })
    return { show() {}, onStatus: hub.onStatus, dispose: hub.clear }
  }

  const ball = createBall()
  syncBallMesh(room, ball)
  let view: PuppyView | null = null
  let petting = false
  const now = () => performance.now() / 1000

  const breeds = createBreedSwitch({
    load: loadPuppyGeometry,
    peek: peekPuppyGeometry,
    mount(id, built) {
      view = mountPuppyView(room, previewPuppy(id), built, room.quality)
    },
    unmount() {
      view?.dispose()
      view = null
      petting = false
    },
    status: (s) => hub.set({ loading: s.loading, notice: s.failed ? FAILED : null }),
  })

  const detach = attachPointer(canvas, room.camera, {
    hit: (ray) => (view ? hitZone(view, ray) : null),
    ballInHand: () => false,
    onBall: () => false,
    free: () => true,
    petStart(hit, t) {
      if (!view) return
      petting = true
      startPet(view.behaviour, hit.zone, hit.point, t)
    },
    petMove(hit, t, px) {
      if (view && petting && movePet(view.behaviour, hit.zone, hit.point, t, px))
        room.emitHeart(hit.point)
    },
    petEnd() {
      if (view && petting) endPet(view.behaviour)
      petting = false
    },
    look(ray, t) {
      if (view) pointLook(view, ray, room.camera, t)
    },
    leave(t) {
      if (view) view.behaviour.pointerAt = t - 1.2
    },
    // A tap does not send the puppy walking: it stays in the middle of the preview
    gesture() {},
  })

  room.start((dt, t) => {
    if (view) tickPuppies([view], { room, ball, now: now(), petting: petting ? view : null }, dt, t)
  })

  return {
    show: breeds.show,
    onStatus: hub.onStatus,
    dispose() {
      breeds.stop()
      hub.clear()
      detach()
      view?.dispose()
      view = null
      room.dispose()
    },
  }
}
