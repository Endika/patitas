import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/presentation/App'
import { adoptPuppy } from '@/application/adoption'
import { BREEDS } from '@/domain/breeds'
import { createCare } from '@/domain/care'
import type { GameStorage } from '@/infrastructure/storage'
import { createFakePreview, createFakeStage, needs, savingStorage } from './fakeStage'

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

const start = (
  storage: GameStorage,
  {
    stage = createFakeStage(),
    now = Date.now,
  }: { stage?: ReturnType<typeof createFakeStage>; now?: () => number } = {},
) => {
  render(
    <App
      openStorage={async () => storage}
      createStage={stage.create}
      createPreview={createFakePreview().create}
      now={now}
    />,
  )
  return stage
}

const ids = async (storage: GameStorage) =>
  new Map((await storage.listPuppies()).map((p) => [p.name, p.id]))

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime()

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

    stage.emit({ ball: { inHand: true, disabled: false }, hint: '¡Allá va!' })
    expect(await screen.findByText('¡Allá va!')).toBeInTheDocument()
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

  it('fills the bowl, bathes, brushes and weighs the puppy through the care bar', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna'])
    const luna = (await ids(storage)).get('Luna')!
    const stage = start(storage)
    stage.emit({ needs: [needs(luna, 'Luna')] })

    await user.click(await screen.findByRole('button', { name: 'Comida' }))
    await user.click(screen.getByRole('button', { name: 'Baño' }))
    expect(stage.calls).toEqual(['feed:0', 'bath:0'])

    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'bath', bath: 'scrub' })] }))
    expect(screen.queryByRole('button', { name: 'Comida' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aclarar' }))
    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'bath', bath: 'rinsed' })] }))
    expect(screen.queryByRole('button', { name: 'Aclarar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Secador' }))
    await user.click(screen.getByRole('button', { name: 'Terminar' }))
    expect(stage.calls.slice(2)).toEqual(['rinse', 'dryer', 'finishBath'])

    act(() => stage.emit({ needs: [needs(luna, 'Luna')] }))
    await user.click(screen.getByRole('button', { name: 'Cepillo' }))
    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'brush' })] }))
    await user.click(screen.getByRole('button', { name: 'Terminar' }))
    act(() => stage.emit({ needs: [needs(luna, 'Luna')] }))
    await user.click(screen.getByRole('button', { name: 'Pesar' }))
    expect(stage.calls.slice(5)).toEqual(['brush:0', 'endBrush', 'weigh:0'])

    act(() =>
      stage.emit({
        needs: [needs(luna, 'Luna', { reading: '4,3 kg', weightStatus: 'En su peso' })],
      }),
    )
    expect(screen.getByText('4,3 kg · En su peso')).toBeInTheDocument()
  })

  it('shows each puppy its own needs and health, by name, and no single happiness bar', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna', 'Kira'])
    const byName = await ids(storage)
    const stage = start(storage)
    await roster()
    act(() =>
      stage.emit({
        needs: [
          needs(byName.get('Luna')!, 'Luna', { happiness: 0.9, hunger: 0.2, health: 'Muy bien' }),
          needs(byName.get('Kira')!, 'Kira', {
            happiness: 0.3,
            hunger: 0.95,
            cleanliness: 0.4,
            energy: 0.1,
            health: 'Necesita cuidados',
          }),
        ],
      }),
    )

    const luna = within(screen.getByRole('region', { name: 'Luna' }))
    const kira = within(screen.getByRole('region', { name: 'Kira' }))
    const value = (card: typeof luna, name: string) =>
      card.getByRole('meter', { name }).getAttribute('aria-valuenow')
    expect(['Felicidad', 'Hambre', 'Limpieza', 'Energía'].map((n) => value(luna, n))).toEqual([
      '90',
      '20',
      '100',
      '80',
    ])
    expect(['Felicidad', 'Hambre', 'Limpieza', 'Energía'].map((n) => value(kira, n))).toEqual([
      '30',
      '95',
      '40',
      '10',
    ])
    expect(luna.getByText('Muy bien')).toBeInTheDocument()
    expect(kira.getByText('Necesita cuidados')).toBeInTheDocument()
    expect(screen.getAllByRole('meter', { name: 'Felicidad' })).toHaveLength(2)

    // The first is looked after until another is picked, on its card or in the room
    await user.click(screen.getByRole('button', { name: 'Comida' }))
    await user.click(kira.getByRole('button', { name: 'Kira' }))
    expect(kira.getByRole('button', { name: 'Kira' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Comida' }))
    act(() => stage.emit({ touched: { id: byName.get('Luna')!, count: 1 } }))
    await user.click(screen.getByRole('button', { name: 'Pesar' }))
    expect(stage.calls).toEqual(['feed:0', 'feed:1', 'weigh:0'])
  })

  it('says «¡Limpio!» while a mess is being cleaned up', async () => {
    const storage = await adopted(['Kuma'])
    const stage = start(storage)
    await roster()
    act(() => stage.emit({ cleaned: true }))
    expect(screen.getByText('¡Limpio!')).toBeInTheDocument()
    act(() => stage.emit({ cleaned: false }))
    expect(screen.queryByText('¡Limpio!')).not.toBeInTheDocument()
  })

  it('brings each puppy in with the time it was away, and keeps its care when it leaves', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna', 'Kira'])
    const byName = await ids(storage)
    const luna = byName.get('Luna')!,
      kira = byName.get('Kira')!
    for (const id of [luna, kira])
      await storage.saveCare(id, { ...createCare(BREEDS.beagle, at(15, 12)), hunger: 0.2 })
    let now = at(18, 12)
    const stage = start(storage, {
      stage: createFakeStage(() => ({ x: 0, z: 0.5 })),
      now: () => now,
    })

    await waitFor(() => expect(stage.arrived.map((a) => a.id)).toEqual([luna, kira]))
    for (const { care } of stage.arrived) {
      expect(care.lastSeen).toBe(at(18, 12))
      expect(care.hunger).toBeCloseTo(0.85)
      // Half of the 0.55 lost to three days away, and two accidents of 0.03 each
      expect(care.messes).toHaveLength(2)
      expect(care.cleanliness).toBeCloseTo(1 - 0.275 - 0.06)
    }

    // Fed and both messes cleaned up in the room
    stage.hold(luna, { ...stage.arrived[0]!.care, hunger: 0.1, messes: [] })
    now = at(18, 13)
    await user.click((await roster()).getByRole('button', { name: 'Sacar a Luna' }))
    await waitFor(async () => expect((await storage.loadCare(luna))?.hunger).toBe(0.1))
    expect(await storage.loadCare(luna)).toMatchObject({ lastSeen: at(18, 13), messes: [] })
    expect(stage.names()).toEqual(['Kira'])
  })

  it('keeps the care of every puppy when the app is hidden', async () => {
    const storage = await adopted(['Luna'])
    const luna = (await ids(storage)).get('Luna')!
    const stage = start(storage, { now: () => at(18, 9) })
    await waitFor(() => expect(stage.arrived).toHaveLength(1))
    stage.hold(luna, { ...stage.arrived[0]!.care, happiness: 0.77 })

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

    await waitFor(async () => expect((await storage.loadCare(luna))?.happiness).toBe(0.77))
    expect((await storage.loadCare(luna))?.lastSeen).toBe(at(18, 9))
  })
})
