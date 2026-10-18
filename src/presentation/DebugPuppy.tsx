import { useEffect, useRef, useState } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'
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
  tickPuppy,
  type PuppyView,
} from '@/engine/puppy/view'
import { createBall, stepBall, throwVelocity } from '@/engine/room/ball'
import { clampPlay } from '@/engine/room/camera'
import { attachPointer, rayHitsBall } from '@/engine/room/input'
import { goTo } from '@/engine/motion/locomotion'
import {
  createRoomScene,
  defaultQuality,
  keepInPlay,
  syncBallMesh,
  type RoomScene,
} from '@/engine/room/scene'
import { HINTS } from './hints'
import './debugPuppy.css'

const NAMES: Record<BreedId, string> = { dorado: 'Canela', shiba: 'Kuma', beagle: 'Txiki' }

type Trick = 'sit' | 'lie' | 'belly'
const TRICKS: [Trick, string][] = [
  ['sit', 'Sentado'],
  ['lie', 'Tumbado'],
  ['belly', 'Panza arriba'],
]

interface Controls {
  ball(): void
  trick(t: Trick): void
}

/** One puppy in the room with the prototype's controls, for checking the render by eye. */
export default function DebugPuppy({ breedId }: { breedId: BreedId }) {
  const breed = BREEDS[breedId],
    name = NAMES[breedId]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const joyRef = useRef<HTMLElement>(null)
  const controls = useRef<Controls | null>(null)
  const [hint, setHint] = useState<HintKey>('idle')
  const [ballUi, setBallUi] = useState({ inHand: false, disabled: false })
  const [loading, setLoading] = useState<string | null>(
    hasPuppyGeometry(breedId) ? null : `Preparando a ${name}…`,
  )

  useEffect(() => {
    const canvas = canvasRef.current!
    let cleanup = () => {}
    // Meshing blocks the page for a couple of seconds: let the loading text paint first
    const timer = setTimeout(() => {
      cleanup = mount(canvas)
    }, 40)
    const mount = (canvas: HTMLCanvasElement): (() => void) => {
      let room: RoomScene
      try {
        room = createRoomScene(canvas, defaultQuality())
      } catch {
        setLoading('Este navegador no puede mostrar gráficos 3D.')
        return () => {}
      }
      const puppy: Puppy = {
        id: `debug-${breedId}`,
        name,
        breedId,
        persona: breed.defaultPersona,
        adoptedAt: 0,
      }
      const ball = createBall()
      const views: PuppyView[] = []
      let petView: PuppyView | null = null
      let hintNow: HintKey = 'idle',
        uiNow = ''
      const now = () => performance.now() / 1000
      const free = () => views.every((v) => v.fetch.task === 'free')
      const mood = (v: PuppyView) => ({
        happy: v.behaviour.happy,
        energy: v.persona.energy,
        clamp: (x: number, z: number) => clampPlay(room.cam, x, z),
      })

      controls.current = {
        ball() {
          if (ball.state === 'hand') putBallAway(views, ball)
          else if (free()) offerBall(views, ball)
        },
        trick(t) {
          for (const v of views) askTrick(v, t)
        },
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

      views.push(mountPuppyView(room, puppy, puppyGeometry(breed), room.quality))
      setLoading(null)

      room.start((dt, t) => {
        stepBall(ball, room.cam, dt)
        syncBallMesh(room, ball)
        for (const v of views) {
          const ev = tickPuppy(v, { room, ball, now: now(), petting: v === petView }, dt, t)
          if (ev.dropped) {
            const at = headWorld(v)
            for (let i = 0; i < 3; i++) room.emitHeart(at)
          }
        }
        syncBallMesh(room, ball)
        const v = views[0]
        if (!v) return
        const s = v.behaviour
        const zone = v === petView && now() - s.petLast < 0.35 ? s.zone : null
        hintNow = pickHint(hintNow, {
          fetch: v.fetch,
          motion: v.motion,
          ball,
          zone,
          scratch: s.scratch,
          sincePet: now() - s.petLast,
        })
        setHint(hintNow)
        const ui = `${ball.state === 'hand'}|${v.fetch.task !== 'free' && v.fetch.task !== 'wait'}`
        if (ui !== uiNow) {
          uiNow = ui
          setBallUi({
            inHand: ball.state === 'hand',
            disabled: v.fetch.task !== 'free' && v.fetch.task !== 'wait',
          })
        }
        if (joyRef.current) joyRef.current.style.transform = `scaleX(${s.happy.toFixed(2)})`
      })
      return () => {
        detach()
        offResize()
        for (const v of views) v.dispose()
        room.dispose()
        controls.current = null
      }
    }
    return () => {
      clearTimeout(timer)
      cleanup()
    }
  }, [breed, breedId, name])

  return (
    <div className="dbg">
      <canvas
        ref={canvasRef}
        aria-label="Cachorro en 3D. Mueve el dedo para que te mire y desliza sobre él para acariciarlo."
      />
      <header className="dbg-top">
        <div className="dbg-who">
          <span className="dbg-name">{name}</span>
          <span className="dbg-breed">{breed.label} · 3 meses</span>
        </div>
        <nav className="dbg-breeds" aria-label="Raza">
          {(Object.keys(BREEDS) as BreedId[]).map((id) => (
            <a
              key={id}
              href={`?debug=puppy&breed=${id}`}
              aria-current={id === breedId ? 'page' : undefined}
            >
              {BREEDS[id].label}
            </a>
          ))}
        </nav>
      </header>
      <footer className="dbg-bottom">
        <p className="dbg-hint" aria-live="polite">
          {HINTS[hint]}
        </p>
        <button
          type="button"
          className="dbg-ball"
          disabled={ballUi.disabled}
          onClick={() => controls.current?.ball()}
        >
          {ballUi.inHand ? 'Guardar la pelota' : 'Sacar la pelota'}
        </button>
        <nav className="dbg-tricks" aria-label="Trucos">
          {TRICKS.map(([t, label]) => (
            <button key={t} type="button" onClick={() => controls.current?.trick(t)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="dbg-meter">
          <span>Felicidad</span>
          <div className="dbg-bar">
            <i ref={joyRef} />
          </div>
        </div>
      </footer>
      {loading && <div className="dbg-loading">{loading}</div>}
    </div>
  )
}
