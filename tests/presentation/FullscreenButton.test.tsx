import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FullscreenButton, {
  type FullscreenDocument,
  type FullscreenWindow,
} from '@/presentation/components/FullscreenButton'

/** A document with the Fullscreen API, or without it as on an iPhone. */
function fakeDocument({
  enabled = true as boolean | null,
  refuse = false,
}: { enabled?: boolean | null; refuse?: boolean } = {}) {
  const events = new EventTarget()
  const calls: string[] = []
  const doc: FullscreenDocument & { fullscreenElement: Element | null } = {
    fullscreenEnabled: enabled ?? undefined,
    fullscreenElement: null,
    documentElement: {
      requestFullscreen: () => {
        calls.push('enter')
        if (refuse) return Promise.reject(new TypeError('Permissions check failed'))
        doc.fullscreenElement = document.body
        act(() => void events.dispatchEvent(new Event('fullscreenchange')))
        return Promise.resolve()
      },
    },
    exitFullscreen: () => {
      calls.push('exit')
      doc.fullscreenElement = null
      act(() => void events.dispatchEvent(new Event('fullscreenchange')))
      return Promise.resolve()
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  }
  return { doc, calls }
}

/** A window whose display mode is `display`, with or without an orientation lock. */
function fakeWindow({
  display = 'browser',
  lock,
}: {
  display?: string
  lock?: (orientation: string) => Promise<void>
} = {}): FullscreenWindow {
  return {
    matchMedia: (query) => ({ matches: query === `(display-mode: ${display})` }),
    screen: { orientation: { type: 'portrait-primary', lock } },
  }
}

const settle = () => act(() => new Promise((done) => setTimeout(done)))

describe('FullscreenButton', () => {
  it('does not show where the browser has no fullscreen, as on an iPhone', () => {
    const { doc } = fakeDocument({ enabled: null })
    render(<FullscreenButton doc={doc} win={fakeWindow()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not show where fullscreen is turned off', () => {
    const { doc } = fakeDocument({ enabled: false })
    render(<FullscreenButton doc={doc} win={fakeWindow()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not show when the app already opens in fullscreen', () => {
    const { doc } = fakeDocument()
    render(<FullscreenButton doc={doc} win={fakeWindow({ display: 'fullscreen' })} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('enters fullscreen, keeps the orientation and leaves again', async () => {
    const user = userEvent.setup()
    const { doc, calls } = fakeDocument()
    const locked: string[] = []
    // In fullscreen the display mode reads fullscreen too, and the button must stay to leave it
    let display = 'browser'
    const win = fakeWindow({ lock: async (o) => void locked.push(o) })
    win.matchMedia = (query) => ({ matches: query === `(display-mode: ${display})` })
    render(<FullscreenButton doc={doc} win={win} />)

    display = 'fullscreen'
    await user.click(screen.getByRole('button', { name: 'Pantalla completa' }))
    await settle()
    expect(locked).toEqual(['portrait-primary'])

    display = 'browser'
    await user.click(screen.getByRole('button', { name: 'Salir de pantalla completa' }))
    expect(calls).toEqual(['enter', 'exit'])
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeInTheDocument()
  })

  it('ignores an orientation lock the browser refuses', async () => {
    const user = userEvent.setup()
    const { doc } = fakeDocument()
    const win = fakeWindow({ lock: () => Promise.reject(new Error('NotSupportedError')) })
    render(<FullscreenButton doc={doc} win={win} />)
    await user.click(screen.getByRole('button', { name: 'Pantalla completa' }))
    await settle()
    expect(screen.getByRole('button', { name: 'Salir de pantalla completa' })).toBeInTheDocument()
  })

  it('enters without an orientation lock where there is none', async () => {
    const user = userEvent.setup()
    const { doc } = fakeDocument()
    render(<FullscreenButton doc={doc} win={{ ...fakeWindow(), screen: {} }} />)
    await user.click(screen.getByRole('button', { name: 'Pantalla completa' }))
    await settle()
    expect(screen.getByRole('button', { name: 'Salir de pantalla completa' })).toBeInTheDocument()
  })

  it('stays as it was when the browser refuses fullscreen', async () => {
    const user = userEvent.setup()
    const { doc, calls } = fakeDocument({ refuse: true })
    render(<FullscreenButton doc={doc} win={fakeWindow()} />)
    await user.click(screen.getByRole('button', { name: 'Pantalla completa' }))
    await settle()
    expect(calls).toEqual(['enter'])
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeInTheDocument()
  })

  it('follows a fullscreen left another way, as with the system back', async () => {
    const user = userEvent.setup()
    const { doc } = fakeDocument()
    render(<FullscreenButton doc={doc} win={fakeWindow()} />)
    await user.click(screen.getByRole('button', { name: 'Pantalla completa' }))
    void doc.exitFullscreen()
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeInTheDocument()
  })
})
