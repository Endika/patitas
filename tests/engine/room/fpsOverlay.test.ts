import { afterEach, describe, expect, it } from 'vitest'
import { fpsOverlay } from '@/engine/room/scene'

const mount = (search: string) => {
  history.replaceState(null, '', search)
  const host = document.createElement('div')
  const canvas = document.createElement('canvas')
  host.append(canvas)
  return { host, overlay: fpsOverlay(canvas) }
}

afterEach(() => history.replaceState(null, '', '/'))

describe('fpsOverlay', () => {
  it('is not there without ?fps', () => {
    const { host, overlay } = mount('/')
    expect(overlay).toBeNull()
    expect(host.children).toHaveLength(1)
  })

  it('sits in the top-left corner, over the HUD', () => {
    const { host } = mount('/?fps')
    const el = host.lastElementChild as HTMLElement
    // Clear of a notch or rounded corner, as the HUD is
    expect(el.style.top).toBe('max(8px, env(safe-area-inset-top, 0px))')
    expect(el.style.left).toBe('max(8px, env(safe-area-inset-left, 0px))')
    expect(el.style.bottom).toBe('')
    expect(el.style.right).toBe('')
    // The sheet that opens under «Cachorros», the highest in the HUD, has z-index 2
    expect(Number(el.style.zIndex)).toBeGreaterThan(2)
  })
})
