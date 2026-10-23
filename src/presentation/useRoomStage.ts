import { useEffect, useRef, useState } from 'react'
import type { Deed } from '@/domain/wallet'
import type { RoomStage, StageStatus } from './roomStage'

const CANVAS_LABEL =
  'Cachorro en 3D. Mueve el dedo para que te mire y desliza sobre él para acariciarlo.'

/**
 * Mounts a stage on a canvas of its own inside `hostRef` and keeps its status. `beforeDispose`
 * gets a last look at a stage on its way out; `onDeed` hears of every deed done in the room.
 */
export function useRoomStage(
  createStage: (canvas: HTMLCanvasElement) => RoomStage,
  beforeDispose?: (stage: RoomStage) => void,
  onDeed?: (deed: Deed) => void,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<RoomStage | null>(null)
  const [status, setStatus] = useState<StageStatus | null>(null)
  const lastLook = useRef(beforeDispose)
  const deed = useRef(onDeed)
  useEffect(() => {
    lastLook.current = beforeDispose
    deed.current = onDeed
  })

  useEffect(() => {
    // A disposed stage loses its WebGL context, so a remount never reuses its canvas
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-label', CANVAS_LABEL)
    hostRef.current!.append(canvas)
    const stage = createStage(canvas)
    stageRef.current = stage
    const off = stage.onChange(setStatus)
    const offDeed = stage.onDeed((d) => deed.current?.(d))
    return () => {
      off()
      offDeed()
      lastLook.current?.(stage)
      stage.dispose()
      stageRef.current = null
      canvas.remove()
    }
  }, [createStage])

  return { hostRef, stageRef, status }
}
