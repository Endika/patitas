import { useEffect, useRef, useState } from 'react'
import type { RoomStage, StageStatus } from './roomStage'

const CANVAS_LABEL =
  'Cachorro en 3D. Mueve el dedo para que te mire y desliza sobre él para acariciarlo.'

/** Mounts a stage on a canvas of its own inside `hostRef` and keeps its status. */
export function useRoomStage(createStage: (canvas: HTMLCanvasElement) => RoomStage) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<RoomStage | null>(null)
  const [status, setStatus] = useState<StageStatus | null>(null)

  useEffect(() => {
    // A disposed stage loses its WebGL context, so a remount never reuses its canvas
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-label', CANVAS_LABEL)
    hostRef.current!.append(canvas)
    const stage = createStage(canvas)
    stageRef.current = stage
    const off = stage.onChange(setStatus)
    return () => {
      off()
      stage.dispose()
      stageRef.current = null
      canvas.remove()
    }
  }, [createStage])

  return { hostRef, stageRef, status }
}
