import { useEffect, type RefObject } from 'react'

/** While `open`, a press outside `ref` or the Escape key calls `close`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const press = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', press)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', press)
      document.removeEventListener('keydown', key)
    }
  }, [ref, open, close])
}
