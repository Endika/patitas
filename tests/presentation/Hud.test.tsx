import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Hud, { HINT_MS } from '@/presentation/components/Hud'
import type { StageStatus, TrickPose } from '@/presentation/roomStage'

const status = (hint: string): StageStatus => ({
  hint,
  ball: { inHand: false, disabled: false },
  notice: null,
  needs: [],
  touched: null,
  cleaned: false,
})

const show = (hint = '', more: Partial<Parameters<typeof Hud>[0]> = {}) => {
  const tricks: TrickPose[] = []
  const view = render(
    <Hud
      status={status(hint)}
      idle={false}
      onBall={() => {}}
      onTrick={(pose) => void tricks.push(pose)}
      care={<button type="button">Comida</button>}
      {...more}
    />,
  )
  return { ...view, tricks }
}

afterEach(() => vi.useRealTimers())

describe('Hud', () => {
  it('shows a hint for a while, and a new one again', () => {
    vi.useFakeTimers()
    const { rerender } = show('Toca el suelo.')
    expect(screen.getByText('Toca el suelo.')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(HINT_MS - 100))
    expect(screen.getByText('Toca el suelo.')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(100))
    expect(screen.queryByText('Toca el suelo.')).not.toBeInTheDocument()

    rerender(<Hud status={status('¡Allá va!')} idle={false} onBall={() => {}} onTrick={() => {}} />)
    expect(screen.getByText('¡Allá va!')).toBeInTheDocument()
  })

  it('shows a hint again after the room had none', () => {
    vi.useFakeTimers()
    const hud = (hint: string) => (
      <Hud status={status(hint)} idle={false} onBall={() => {}} onTrick={() => {}} />
    )
    const { rerender } = render(hud('Toca el suelo.'))
    act(() => vi.advanceTimersByTime(HINT_MS))
    expect(screen.queryByText('Toca el suelo.')).not.toBeInTheDocument()
    rerender(hud(''))
    rerender(hud('Toca el suelo.'))
    expect(screen.getByText('Toca el suelo.')).toBeInTheDocument()
  })

  it('shows a hint again when another came and went back before it ran out', () => {
    vi.useFakeTimers()
    const hud = (hint: string) => (
      <Hud status={status(hint)} idle={false} onBall={() => {}} onTrick={() => {}} />
    )
    const { rerender } = render(hud('Toca el suelo.'))
    act(() => vi.advanceTimersByTime(HINT_MS))
    rerender(hud('¡Allá va!'))
    rerender(hud('Toca el suelo.'))
    expect(screen.getByText('Toca el suelo.')).toBeInTheDocument()
  })

  it("moves focus into the mode's controls and back to «Cuidar» when it ends", async () => {
    const user = userEvent.setup()
    const { rerender } = show()
    const hud = (mode?: ReactNode) => (
      <Hud
        status={status('')}
        idle={false}
        onBall={() => {}}
        onTrick={() => {}}
        care={<button type="button">Comida</button>}
        mode={mode}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Cuidar' }))
    await user.click(screen.getByRole('button', { name: 'Comida' }))
    rerender(
      hud(
        <nav aria-label="Baño">
          <button type="button">Aclarar</button>
          <button type="button">Terminar</button>
        </nav>,
      ),
    )
    expect(screen.getByRole('button', { name: 'Aclarar' })).toHaveFocus()
    rerender(hud())
    expect(screen.getByRole('button', { name: 'Cuidar' })).toHaveFocus()
  })

  it('puts a tray after the buttons, starts on its first action and gives focus back', async () => {
    const user = userEvent.setup()
    show()
    const cuidar = screen.getByRole('button', { name: 'Cuidar' })
    const trucos = screen.getByRole('button', { name: 'Trucos' })
    expect(cuidar).not.toHaveAttribute('aria-controls')

    cuidar.focus()
    await user.keyboard('{Enter}')
    const tray = screen.getByRole('navigation', { name: 'Cuidados' })
    expect(cuidar).toHaveAttribute('aria-controls', tray.id)
    expect(trucos.compareDocumentPosition(tray) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Comida' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(tray).not.toBeInTheDocument()
    expect(cuidar).toHaveFocus()

    await user.click(trucos)
    await user.keyboard('{Escape}')
    expect(trucos).toHaveFocus()
  })

  it('opens one tray at a time and closes it once something in it is chosen', async () => {
    const user = userEvent.setup()
    const { tricks } = show()
    const cuidar = screen.getByRole('button', { name: 'Cuidar' })
    const trucos = screen.getByRole('button', { name: 'Trucos' })
    expect(screen.queryByRole('button', { name: 'Comida' })).not.toBeInTheDocument()

    await user.click(cuidar)
    expect(cuidar).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: 'Cuidados' })).toContainElement(
      screen.getByRole('button', { name: 'Comida' }),
    )
    await user.click(trucos)
    expect(screen.queryByRole('button', { name: 'Comida' })).not.toBeInTheDocument()
    expect(cuidar).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: 'Tumbado' }))
    expect(tricks).toEqual(['lie'])
    expect(screen.queryByRole('navigation', { name: 'Trucos' })).not.toBeInTheDocument()
    expect(trucos).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes a tray with Escape, a press outside it, or its own button', async () => {
    const user = userEvent.setup()
    show()
    const trucos = screen.getByRole('button', { name: 'Trucos' })
    const open = () => screen.queryByRole('navigation', { name: 'Trucos' })

    await user.click(trucos)
    await user.keyboard('{Escape}')
    expect(open()).not.toBeInTheDocument()

    await user.click(trucos)
    fireEvent.pointerDown(document.body)
    expect(open()).not.toBeInTheDocument()

    await user.click(trucos)
    await user.click(trucos)
    expect(open()).not.toBeInTheDocument()
  })

  it('shows only the controls of a care mode while it lasts', () => {
    show('', { mode: <button type="button">Terminar</button> })
    expect(screen.getByRole('button', { name: 'Terminar' })).toBeInTheDocument()
    for (const name of ['Cuidar', 'Trucos', 'Sacar la pelota'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })
})
