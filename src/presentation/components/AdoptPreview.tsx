import { useEffect, useRef, useState } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import type { PreviewStage, PreviewStatus } from '../previewStage'
import { swatch } from '../swatch'

export type CreatePreview = (canvas: HTMLCanvasElement) => PreviewStage

// three.js arrives with the preview, so the form paints without waiting for it
const loadThreePreview = (): Promise<CreatePreview> =>
  import('../previewStage').then((m) => m.createThreePreviewStage)

const label = (id: BreedId) => `Vista previa del cachorro ${BREEDS[id].label}`

/** The chosen breed in 3D, to stroke before adopting; its silhouette while it gets ready. */
export default function AdoptPreview({
  breedId,
  createPreview,
}: {
  breedId: BreedId
  /** Defaults to the three.js preview, loaded on first use. */
  createPreview?: CreatePreview
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<PreviewStage | null>(null)
  const shownRef = useRef<BreedId | null>(null)
  const breedRef = useRef(breedId)
  const [status, setStatus] = useState<PreviewStatus>({ loading: true, notice: null })

  useEffect(() => {
    // A disposed stage loses its WebGL context, so a remount never reuses its canvas
    const canvas = document.createElement('canvas')
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', label(breedRef.current))
    hostRef.current!.append(canvas)
    canvasRef.current = canvas
    let stage: PreviewStage | null = null
    let off = () => {}
    let gone = false
    const attach = (create: CreatePreview) => {
      if (gone) return
      stage = create(canvas)
      stageRef.current = stage
      off = stage.onStatus(setStatus)
      shownRef.current = breedRef.current
      stage.show(breedRef.current)
    }
    if (createPreview) attach(createPreview)
    else
      loadThreePreview().then(attach, () => {
        if (!gone) setStatus({ loading: false, notice: 'No se pudo preparar al cachorro.' })
      })
    return () => {
      gone = true
      off()
      stage?.dispose()
      stageRef.current = null
      canvasRef.current = null
      canvas.remove()
    }
  }, [createPreview])

  useEffect(() => {
    breedRef.current = breedId
    canvasRef.current?.setAttribute('aria-label', label(breedId))
    if (!stageRef.current || shownRef.current === breedId) return
    shownRef.current = breedId
    stageRef.current.show(breedId)
  }, [breedId])

  const waiting = status.loading || status.notice !== null
  return (
    // Takes what the form leaves of the screen, up to 40 %, so «Adoptar» stays in view
    <div className="relative max-h-[40dvh] min-h-48 w-full flex-[1_1_0] overflow-hidden rounded-3xl border border-line bg-glass">
      <div
        ref={hostRef}
        className="absolute inset-0 *:block *:size-full *:touch-none *:select-none"
      />
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 text-center ${waiting ? '' : 'hidden'}`}
      >
        <span
          aria-hidden="true"
          className="aspect-square h-2/5 rounded-full border border-line shadow-sm"
          style={{ background: swatch(breedId) }}
        />
        <p role="status" className="font-semibold text-ink-soft">
          {waiting ? (status.notice ?? 'Preparando al cachorro…') : ''}
        </p>
      </div>
    </div>
  )
}
