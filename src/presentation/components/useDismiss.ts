import { useEffect, type RefObject } from 'react'

/** How a popover was dismissed: Escape gives focus back to what opened it, a press elsewhere not. */
export type Dismissal = 'escape' | 'outside'

/** While `open`, a press outside `ref` or the Escape key calls `close`. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: (how: Dismissal) => void,
) {
  useEffect(() => {
    if (!open) return
    const press = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close('outside')
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close('escape')
    }
    document.addEventListener('pointerdown', press)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', press)
      document.removeEventListener('keydown', key)
    }
  }, [ref, open, close])
}
