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
  tickPuppies,
  type PuppyView,
} from '@/engine/puppy/view'
import { createBall, stepBall, throwVelocity } from '@/engine/room/ball'
import { clampPlay } from '@/engine/room/camera'
import { attachPointer, rayHitsBall } from '@/engine/room/input'
import { goTo } from '@/engine/motion/locomotion'
import { createRoomScene, keepInPlay, syncBallMesh, type RoomScene } from '@/engine/room/scene'
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

const debugNames = (ids: BreedId[]) =>
  ids.map((id, i) => (i > 0 && id === ids[0] ? `${NAMES[id]} 2` : NAMES[id]))

/** Where each puppy starts, for one or two. */
const PLACES = [
  [{ x: 0, z: 0 }],
  [
    { x: -0.32, z: 0, heading: 0.25 },
    { x: 0.32, z: 0, heading: -0.25 },
  ],
]

/** One or two puppies in the room with the prototype's controls, for checking the render by eye. */
export default function DebugPuppy({ breedIds }: { breedIds: BreedId[] }) {
  const key = breedIds.join(',')
  const name = debugNames(breedIds).join(' y ')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const joyRef = useRef<HTMLElement>(null)
  const controls = useRef<Controls | null>(null)
  const [hint, setHint] = useState<HintKey>('idle')
  const [ballUi, setBallUi] = useState({ inHand: false, disabled: false })
  const [loading, setLoading] = useState<string | null>(
    breedIds.every(hasPuppyGeometry) ? null : `Preparando a ${name}…`,
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
        room = createRoomScene(canvas)
      } catch {
        setLoading('Este navegador no puede mostrar gráficos 3D.')
        return () => {}
      }
      const ids = key.split(',') as BreedId[],
        names = debugNames(ids)
      const puppies = ids.map((breedId, i): Puppy => ({
        id: `debug-${i}-${breedId}`,
        name: names[i]!,
        breedId,
        persona: BREEDS[breedId].defaultPersona,
        adoptedAt: 0,
      }))
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

      const places = PLACES[puppies.length - 1]!
      puppies.forEach((p, i) =>
        views.push(
          mountPuppyView(room, p, puppyGeometry(BREEDS[p.breedId]), room.quality, places[i]),
        ),
      )
      setLoading(null)

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
        if (!v) return
        const s = v.behaviour
        const zone = v === petView && now() - s.petLast < 0.35 ? s.zone : null
        hintNow = pickHint(hintNow, {
          fetch: v.fetch,
          motion: v.motion,
          zone,
          scratch: s.scratch,
          sincePet: now() - s.petLast,
        })
        setHint(hintNow)
        const busy = v.fetch.task !== 'free' && v.fetch.task !== 'wait'
        const ui = `${ball.state === 'hand'}|${busy}`
        if (ui !== uiNow) {
          uiNow = ui
          setBallUi({ inHand: ball.state === 'hand', disabled: busy })
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
  }, [key])

  return (
    <div className="dbg">
      <canvas
        ref={canvasRef}
        aria-label="Cachorro en 3D. Mueve el dedo para que te mire y desliza sobre él para acariciarlo."
      />
      <header className="dbg-top">
        <div className="dbg-who">
          <span className="dbg-name">{name}</span>
          <span className="dbg-breed">
            {breedIds.map((id) => BREEDS[id].label).join(' y ')} · 3 meses
          </span>
        </div>
        <nav className="dbg-breeds" aria-label="Raza">
          {(Object.keys(BREEDS) as BreedId[]).map((id) => (
            <a
              key={id}
              href={`?debug=puppy&breed=${id}${breedIds[1] ? `&breed2=${breedIds[1]}` : ''}`}
              aria-current={id === breedIds[0] ? 'page' : undefined}
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
