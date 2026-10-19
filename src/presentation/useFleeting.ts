import { useEffect, useState } from 'react'

/**
 * `value` for `ms` after it appears, then null: for messages that should not stay over the room.
 * A different value shows again, and so does the same one after any other in between.
 */
export function useFleeting<T>(value: T | null, ms: number): T | null {
  const [gone, setGone] = useState<T | null>(null)
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    setGone(null)
  }
  useEffect(() => {
    if (value === null) return
    const timer = setTimeout(() => setGone(() => value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return value !== null && value !== gone ? value : null
}
