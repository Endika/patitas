import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/presentation/App'
import { NOTICE_MS } from '@/presentation/screens/RoomScreen'
import { adoptPuppy } from '@/application/adoption'
import { BREEDS } from '@/domain/breeds'
import { createCare, health } from '@/domain/care'
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

/** The page goes to the background or comes back, as a phone does. */
const hide = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

/** Every adopted puppy, behind «Cachorros» unless the room is empty. */
const roster = async () => {
  const list = () => screen.queryByRole('list', { name: 'Tus cachorros' })
  // React 19 holds a Suspense fallback at least 300 ms before showing the lazy screen
  await waitFor(
    () => expect(list() ?? screen.queryByRole('button', { name: 'Cachorros' })).toBeTruthy(),
    { timeout: 3000 },
  )
  if (!list()) await userEvent.click(screen.getByRole('button', { name: 'Cachorros' }))
  return within(list()!)
}

/** Opens «Cuidar» and chooses `action` in it. */
const care = async (user: ReturnType<typeof userEvent.setup>, action: string) => {
  await user.click(await screen.findByRole('button', { name: 'Cuidar' }))
  await user.click(screen.getByRole('button', { name: action }))
}

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
    // The chip already shows the name, so the button only shows the verb
    expect(enterToby).toHaveTextContent(/^Meter$/)
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

    for (const label of ['Sentado', 'Tumbado', 'Panza arriba']) {
      await user.click(screen.getByRole('button', { name: 'Trucos' }))
      await user.click(screen.getByRole('button', { name: label }))
    }
    expect(stage.calls).toEqual([
      'takeBall',
      'stowBall',
      'trick:0:sit',
      'trick:0:lie',
      'trick:0:belly',
    ])
  })

  it('gives a trick only to the puppy picked, and rings it while there are two', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna', 'Kira'])
    const byName = await ids(storage)
    const stage = start(storage)
    await roster()
    const sit = async () => {
      await user.click(screen.getByRole('button', { name: 'Trucos' }))
      await user.click(screen.getByRole('button', { name: 'Sentado' }))
    }
    act(() => stage.emit({ needs: [needs(byName.get('Luna')!, 'Luna')] }))
    expect(stage.selected.at(-1)).toBeNull()

    act(() =>
      stage.emit({
        needs: [needs(byName.get('Luna')!, 'Luna'), needs(byName.get('Kira')!, 'Kira')],
      }),
    )
    expect(stage.selected.at(-1)).toBe(0)
    await sit()
    // Tapping the other puppy in the room makes it the one the orders are for
    act(() => stage.emit({ touched: { id: byName.get('Kira')!, count: 1 } }))
    expect(stage.selected.at(-1)).toBe(1)
    await sit()
    await user.click(screen.getByRole('button', { name: /^Luna,/ }))
    expect(stage.selected.at(-1)).toBe(0)
    await sit()
    expect(stage.calls).toEqual(['trick:0:sit', 'trick:1:sit', 'trick:0:sit'])
  })

  it('goes back to adopting another puppy', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna'])
    start(storage)

    await roster()
    await user.click(screen.getByRole('button', { name: 'Adoptar otro' }))
    await user.type(screen.getByLabelText('Nombre'), 'Kira')
    await user.click(screen.getByRole('button', { name: 'Adoptar' }))

    expect(await screen.findByRole('heading', { name: 'Luna y Kira' })).toBeInTheDocument()
    expect(await storage.listPuppies()).toHaveLength(2)
  })

  it('tells the player a puppy adopted into a full room waits outside', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna', 'Kira'])
    const stage = start(storage)

    await roster()
    await user.click(screen.getByRole('button', { name: 'Adoptar otro' }))
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
    await roster()
    await user.click(screen.getByRole('button', { name: 'Adoptar otro' }))
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

    await care(user, 'Comida')
    await care(user, 'Baño')
    expect(stage.calls).toEqual(['feed:0', 'bath:0'])

    // In the bath, its controls are the only ones
    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'bath', bath: 'scrub' })] }))
    for (const name of ['Cuidar', 'Trucos', 'Sacar la pelota'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aclarar' }))
    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'bath', bath: 'rinsed' })] }))
    expect(screen.queryByRole('button', { name: 'Aclarar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Secador' }))
    await user.click(screen.getByRole('button', { name: 'Terminar' }))
    expect(stage.calls.slice(2)).toEqual(['rinse', 'dryer', 'finishBath'])

    act(() => stage.emit({ needs: [needs(luna, 'Luna')] }))
    await care(user, 'Cepillo')
    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'brush' })] }))
    expect(screen.queryByRole('button', { name: 'Cuidar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Terminar' }))
    act(() => stage.emit({ needs: [needs(luna, 'Luna')] }))
    await care(user, 'Pesar')
    expect(stage.calls.slice(5)).toEqual(['brush:0', 'endBrush', 'weigh:0'])

    // The reading shows on the puppy's chip, and with how it is doing on its card
    act(() =>
      stage.emit({
        needs: [needs(luna, 'Luna', { reading: '5,24 kg', weightStatus: 'En su peso' })],
      }),
    )
    const chip = screen.getByRole('button', { name: /^Luna,/ })
    expect(chip).toHaveTextContent('5,24 kg')
    await user.click(chip)
    expect(screen.getByText('5,24 kg · En su peso')).toBeInTheDocument()
  })

  it('shows each puppy its own needs and health on a card its chip opens', async () => {
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

    // Each chip tells its puppy's health and opens its card, one at a time
    const luna = screen.getByRole('button', { name: 'Luna, Muy bien' })
    const kira = screen.getByRole('button', { name: 'Kira, Necesita cuidados' })
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    expect(luna).toHaveAttribute('aria-expanded', 'false')
    expect(luna).not.toHaveAttribute('aria-controls')
    const value = (name: string) =>
      within(screen.getByRole('region')).getByRole('meter', { name }).getAttribute('aria-valuenow')
    const bars = ['Felicidad', 'Hambre', 'Limpieza', 'Energía']
    await user.click(luna)
    const card = screen.getByRole('region', { name: 'Luna' })
    expect(luna).toHaveAttribute('aria-expanded', 'true')
    expect(luna).toHaveAttribute('aria-controls', card.id)
    expect(card).toHaveTextContent('Beagle')
    expect(card).toHaveTextContent('Muy bien')
    expect(bars.map(value)).toEqual(['90', '20', '100', '80'])
    await user.click(kira)
    expect(screen.queryByRole('region', { name: 'Luna' })).not.toBeInTheDocument()
    expect(luna).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('region', { name: 'Kira' })).toHaveTextContent('Necesita cuidados')
    expect(bars.map(value)).toEqual(['30', '95', '40', '10'])
    await user.click(kira)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(kira).toHaveAttribute('aria-expanded', 'false')
    // Escape closes a card and leaves focus on its chip
    await user.click(kira)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(kira).toHaveFocus()

    // Kira, picked on her chip, is looked after until another is picked, on a chip or in the room
    expect(kira).toHaveAttribute('aria-current', 'true')
    expect(luna).not.toHaveAttribute('aria-current')
    await care(user, 'Comida')
    await user.click(luna)
    await care(user, 'Comida')
    act(() => stage.emit({ touched: { id: byName.get('Kira')!, count: 1 } }))
    expect(kira).toHaveAttribute('aria-current', 'true')
    await care(user, 'Pesar')
    expect(stage.calls).toEqual(['feed:1', 'feed:0', 'weigh:1'])
  })

  it('keeps every puppy behind «Cachorros», and shows them when the room is empty', async () => {
    const user = userEvent.setup()
    start(await adopted(['Luna']))
    const toggle = await screen.findByRole('button', { name: 'Cachorros' }, { timeout: 3000 })
    const list = () => screen.queryByRole('list', { name: 'Tus cachorros' })
    expect(list()).not.toBeInTheDocument()

    expect(toggle).not.toHaveAttribute('aria-controls')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls')
    expect(screen.getByRole('button', { name: 'Adoptar otro' })).toBeInTheDocument()
    screen.getByRole('button', { name: 'Sacar a Luna' }).focus()
    await user.keyboard('{Escape}')
    expect(list()).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()

    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Sacar a Luna' }))
    expect(await screen.findByRole('heading', { name: 'La sala está vacía' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Cachorros' })).not.toBeInTheDocument()
    expect(list()).toBeInTheDocument()
  })

  it('lets the full-room and waiting-outside notices go after a while', async () => {
    const storage = await adopted(['Luna', 'Kira', 'Toby'])
    start(storage)
    const list = await roster()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const full = 'Ya hay dos cachorros en la sala. Saca uno para que entre otro.'

    await user.click(list.getByRole('button', { name: 'Meter a Toby' }))
    expect(await screen.findByText(full)).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(NOTICE_MS))
    expect(screen.queryByText(full)).not.toBeInTheDocument()
    // Refused again, it says so again
    await user.click(list.getByRole('button', { name: 'Meter a Toby' }))
    expect(await screen.findByText(full)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Adoptar otro' }))
    await user.type(screen.getByLabelText('Nombre'), 'Nala')
    await user.click(screen.getByRole('button', { name: 'Adoptar' }))
    const outside = 'Nala espera fuera: saca a uno para que entre.'
    expect(await screen.findByText(outside)).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(NOTICE_MS))
    expect(screen.queryByText(outside)).not.toBeInTheDocument()
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

  it('saves every 30 s while shown, once as it hides, and catches up 3 days on return', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const storage = await adopted(['Luna'])
    const luna = (await ids(storage)).get('Luna')!
    await storage.saveCare(luna, createCare(BREEDS.beagle, at(15, 12)))
    let now = at(15, 12)
    const stage = start(storage, {
      stage: createFakeStage(() => ({ x: 0, z: 0.5 })),
      now: () => now,
    })
    await waitFor(() => expect(stage.arrived).toHaveLength(1))
    const saved = async () => (await storage.loadCare(luna))!

    stage.hold(luna, { ...stage.arrived[0]!.care, hunger: 0.2 })
    now = at(15, 12) + 30_000
    act(() => vi.advanceTimersByTime(30_000))
    await waitFor(async () => expect((await saved()).lastSeen).toBe(now))

    hide('hidden')
    await waitFor(async () => expect((await saved()).lastSeen).toBe(at(15, 12) + 30_000))
    // Nothing more is saved while hidden, so the absence stays on record
    now = at(16, 12)
    act(() => vi.advanceTimersByTime(120_000))
    await new Promise((r) => setTimeout(r, 20))
    expect((await saved()).lastSeen).toBe(at(15, 12) + 30_000)

    now = at(18, 12) + 30_000
    hide('visible')
    expect(stage.calls).toContain(`resume:${3 * 24 * 3_600_000}`)
    await waitFor(async () => expect((await saved()).lastSeen).toBe(now))
    const back = await saved()
    expect(back.hunger).toBeCloseTo(0.85)
    expect(back.messes).toHaveLength(2)
    expect(back.cleanliness).toBeCloseTo(1 - 0.275 - 0.06)
    expect(health(back, BREEDS.beagle)).toBe('Bien')
  })

  it('saves the care of every puppy when the room closes', async () => {
    const storage = await adopted(['Luna'])
    const luna = (await ids(storage)).get('Luna')!
    const stage = createFakeStage()
    const { unmount } = render(
      <App
        openStorage={async () => storage}
        createStage={stage.create}
        createPreview={createFakePreview().create}
        now={() => at(18, 9)}
      />,
    )
    await waitFor(() => expect(stage.arrived).toHaveLength(1))
    stage.hold(luna, { ...stage.arrived[0]!.care, energy: 0.33 })
    unmount()
    await waitFor(async () => expect((await storage.loadCare(luna))?.energy).toBe(0.33))
  })

  it('tells the player when the care could not be loaded, and the room still plays', async () => {
    const storage = await adopted(['Luna'])
    const broken: GameStorage = {
      ...storage,
      loadCare: () => Promise.reject(new Error('IDB down')),
      saveCare: () => Promise.reject(new Error('IDB down')),
    }
    const user = userEvent.setup()
    const stage = start(broken)
    expect(await screen.findByText('No se han podido cargar los cuidados.')).toBeInTheDocument()
    await waitFor(() => expect(stage.names()).toEqual(['Luna']))
    expect(stage.arrived[0]!.care.hunger).toBe(0.3)
    // Saves fail quietly: leaving and hiding do not throw
    hide('hidden')
    hide('visible')
    await user.click((await roster()).getByRole('button', { name: 'Sacar a Luna' }))
    await waitFor(() => expect(stage.names()).toEqual([]))
  })

  it('never saves over care it could not load, and clears the notice as that puppy goes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const user = userEvent.setup()
    const storage = await adopted(['Luna', 'Kira'])
    const byName = await ids(storage)
    const luna = byName.get('Luna')!,
      kira = byName.get('Kira')!
    await storage.saveCare(luna, { ...createCare(BREEDS.beagle, at(18, 9)), hunger: 0.2 })
    let failing = true
    const saved: string[] = []
    const flaky: GameStorage = {
      ...storage,
      loadCare: (id) =>
        failing && id === luna ? Promise.reject(new Error('IDB busy')) : storage.loadCare(id),
      saveCare: (id, care) => {
        saved.push(id)
        return storage.saveCare(id, care)
      },
    }
    const stage = start(flaky, { now: () => at(18, 9) })
    const notice = 'No se han podido cargar los cuidados.'
    expect(await screen.findByText(notice)).toBeInTheDocument()
    await waitFor(() => expect(stage.arrived).toHaveLength(2))

    act(() => vi.advanceTimersByTime(30_000))
    hide('hidden')
    hide('visible')
    await user.click((await roster()).getByRole('button', { name: 'Sacar a Luna' }))
    await waitFor(() => expect(stage.names()).toEqual(['Kira']))
    expect(saved).toContain(kira)
    expect(saved).not.toContain(luna)
    expect((await storage.loadCare(luna))?.hunger).toBe(0.2)
    expect(screen.queryByText(notice)).not.toBeInTheDocument()

    // A later load that works brings the stored care in, and saving it is safe again
    failing = false
    await user.click((await roster()).getByRole('button', { name: 'Meter a Luna' }))
    await waitFor(() => expect(stage.names()).toEqual(['Kira', 'Luna']))
    expect(stage.arrived.at(-1)).toMatchObject({ id: luna, care: { hunger: 0.2 } })
    hide('hidden')
    await waitFor(() => expect(saved).toContain(luna))
    expect(screen.queryByText(notice)).not.toBeInTheDocument()
  })

  it('leaves the absence on record for a puppy in the room it no longer knows', async () => {
    const storage = await adopted(['Luna'])
    const stray = { ...createCare(BREEDS.beagle, at(18, 9)), happiness: 0.6 }
    let now = at(18, 9)
    const stage = start(storage, { now: () => now })
    await waitFor(() => expect(stage.arrived).toHaveLength(1))
    stage.hold('stray', stray)

    hide('hidden')
    await waitFor(async () => expect((await storage.loadCare('stray'))?.lastSeen).toBe(at(18, 9)))
    now = at(18, 15)
    hide('visible')
    const luna = (await ids(storage)).get('Luna')!
    await waitFor(async () => expect((await storage.loadCare(luna))?.lastSeen).toBe(now))
    expect((await storage.loadCare('stray'))?.lastSeen).toBe(at(18, 9))
  })

  it('counts the time away from the start when the room opens in the background', async () => {
    const storage = await adopted(['Luna'])
    let now = at(15, 12)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    const stage = start(storage, {
      stage: createFakeStage(() => ({ x: 0, z: 0.5 })),
      now: () => now,
    })
    await waitFor(() => expect(stage.arrived).toHaveLength(1))

    now = at(15, 12) + 90_000
    hide('visible')
    expect(stage.calls).toContain('resume:90000')
  })

  it('keeps the care of every puppy when the app is hidden', async () => {
    const storage = await adopted(['Luna'])
    const luna = (await ids(storage)).get('Luna')!
    const stage = start(storage, { now: () => at(18, 9) })
    await waitFor(() => expect(stage.arrived).toHaveLength(1))
    stage.hold(luna, { ...stage.arrived[0]!.care, happiness: 0.77 })

    hide('hidden')
    hide('visible')

    await waitFor(async () => expect((await storage.loadCare(luna))?.happiness).toBe(0.77))
    expect((await storage.loadCare(luna))?.lastSeen).toBe(at(18, 9))
  })

  it('closes what is open on the system back, one thing at a time, before asking to leave', async () => {
    const user = userEvent.setup()
    const storage = await adopted(['Luna'])
    const luna = (await ids(storage)).get('Luna')!
    const stage = start(storage)
    const toggle = await screen.findByRole('button', { name: 'Cachorros' }, { timeout: 3000 })
    act(() => stage.emit({ needs: [needs(luna, 'Luna')] }))
    const back = () => act(() => void window.dispatchEvent(new PopStateEvent('popstate')))
    const asked = () => screen.queryByText('Pulsa atrás otra vez para salir')

    await user.click(screen.getByRole('button', { name: 'Cuidar' }))
    back()
    expect(screen.queryByRole('navigation', { name: 'Cuidados' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cuidar' })).toHaveFocus()

    const chip = screen.getByRole('button', { name: /^Luna,/ })
    await user.click(chip)
    back()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(chip).toHaveFocus()

    await user.click(toggle)
    back()
    expect(screen.queryByRole('list', { name: 'Tus cachorros' })).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()

    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'bath', bath: 'scrub' })] }))
    back()
    act(() => stage.emit({ needs: [needs(luna, 'Luna', { mode: 'brush' })] }))
    back()
    expect(stage.calls).toEqual(['finishBath', 'endBrush'])
    expect(asked()).not.toBeInTheDocument()

    act(() => stage.emit({ needs: [needs(luna, 'Luna')] }))
    back()
    expect(asked()).toHaveAttribute('role', 'status')
    expect(window.history.state).toEqual({ patitas: 'guard' })
  })
})
