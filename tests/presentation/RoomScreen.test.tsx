import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/presentation/App'
import { adoptPuppy } from '@/application/adoption'
import type { GameStorage } from '@/infrastructure/storage'
import { createFakePreview, createFakeStage, savingStorage } from './fakeStage'

async function adopted(names: string[]): Promise<GameStorage> {
  const storage = savingStorage()
  let clock = 0
  for (const name of names)
    await adoptPuppy(
      storage,
      { name, breedId: 'beagle' },
      { now: () => ++clock, random: () => 0.5 },
    )
  return storage
}

const start = (storage: GameStorage) => {
  const stage = createFakeStage()
  render(
    <App
      openStorage={async () => storage}
      createStage={stage.create}
      createPreview={createFakePreview().create}
    />,
  )
  return stage
}

const roster = async () =>
  // React 19 holds a Suspense fallback at least 300 ms before showing the lazy screen
  within(await screen.findByRole('list', { name: 'Tus cachorros' }, { timeout: 3000 }))

beforeAll(() => import('@/presentation/screens/RoomScreen'))

describe('RoomScreen', () => {
  it('keeps two puppies in the room and lets the third in once one leaves', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna', 'Kira', 'Toby'])
    const stage = start(storage)

    const list = await roster()
    expect(list.getAllByText('En la sala')).toHaveLength(2)
    await waitFor(() => expect(stage.names()).toEqual(['Luna', 'Kira']))
    expect(screen.getByRole('heading', { name: 'Luna y Kira' })).toBeInTheDocument()

    const enterToby = list.getByRole('button', { name: 'Meter a Toby' })
    expect(enterToby).toHaveTextContent('Meter a Toby')
    await user.click(enterToby)
    expect(
      await screen.findByText('Ya hay dos cachorros en la sala. Saca uno para que entre otro.'),
    ).toBeInTheDocument()
    expect(stage.names()).toEqual(['Luna', 'Kira'])

    await user.click(list.getByRole('button', { name: 'Sacar a Luna' }))
    await user.click(list.getByRole('button', { name: 'Meter a Toby' }))

    expect(await screen.findByRole('heading', { name: 'Kira y Toby' })).toBeInTheDocument()
    await waitFor(() => expect(stage.names()).toEqual(['Kira', 'Toby']))
    expect(screen.queryByText(/Ya hay dos cachorros/)).not.toBeInTheDocument()
    const byName = new Map((await storage.listPuppies()).map((p) => [p.name, p.id]))
    expect(await storage.loadRoom()).toEqual({ inRoom: [byName.get('Kira'), byName.get('Toby')] })
  })

  it('passes the ball and tricks to the room and shows what it reports', async () => {
    const user = userEvent.setup()
    const stage = start(await adopted(['Luna']))

    await user.click(await screen.findByRole('button', { name: 'Sacar la pelota' }))
    expect(stage.calls).toEqual(['takeBall'])

    stage.emit({ ball: { inHand: true, disabled: false }, hint: '¡Allá va!', happiness: 0.8 })
    expect(await screen.findByText('¡Allá va!')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Felicidad' })).toHaveAttribute('aria-valuenow', '80')
    await user.click(screen.getByRole('button', { name: 'Guardar la pelota' }))

    for (const label of ['Sentado', 'Tumbado', 'Panza arriba'])
      await user.click(screen.getByRole('button', { name: label }))
    expect(stage.calls).toEqual(['takeBall', 'stowBall', 'trick:sit', 'trick:lie', 'trick:belly'])
  })

  it('goes back to adopting another puppy', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna'])
    start(storage)

    await user.click(await screen.findByRole('button', { name: 'Adoptar otro' }))
    await user.type(screen.getByLabelText('Nombre'), 'Kira')
    await user.click(screen.getByRole('button', { name: 'Adoptar' }))

    expect(await screen.findByRole('heading', { name: 'Luna y Kira' })).toBeInTheDocument()
    expect(await storage.listPuppies()).toHaveLength(2)
  })

  it('tells the player a puppy adopted into a full room waits outside', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna', 'Kira'])
    const stage = start(storage)

    await user.click(await screen.findByRole('button', { name: 'Adoptar otro' }))
    await user.type(screen.getByLabelText('Nombre'), 'Toby')
    await user.click(screen.getByRole('button', { name: 'Adoptar' }))

    expect(
      await screen.findByText('Toby espera fuera: saca a uno para que entre.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Luna y Kira' })).toBeInTheDocument()
    expect(stage.names()).toEqual(['Luna', 'Kira'])

    const list = await roster()
    await user.click(list.getByRole('button', { name: 'Sacar a Luna' }))
    expect(screen.queryByText(/espera fuera/)).not.toBeInTheDocument()
  })

  it('gives every stage a canvas of its own and removes it when the room goes', async () => {
    const user = userEvent.setup()
    const stage = createFakeStage()
    const { unmount } = render(
      <StrictMode>
        <App
          openStorage={async () => adopted(['Luna'])}
          createStage={stage.create}
          createPreview={createFakePreview().create}
        />
      </StrictMode>,
    )
    await user.click(await screen.findByRole('button', { name: 'Adoptar otro' }))
    await user.click(screen.getByRole('button', { name: 'Volver a la sala' }))
    await screen.findByRole('heading', { name: 'Luna' })

    const { canvases } = stage
    // StrictMode mounts each room twice, and the room is shown twice
    expect(canvases).toHaveLength(4)
    expect(new Set(canvases).size).toBe(canvases.length)
    expect(canvases.filter((c) => c.isConnected)).toEqual([canvases.at(-1)])
    expect(stage.calls.filter((c) => c === 'dispose')).toHaveLength(canvases.length - 1)

    unmount()
    expect(canvases.some((c) => c.isConnected)).toBe(false)
    expect(stage.calls.filter((c) => c === 'dispose')).toHaveLength(canvases.length)
  })
})
