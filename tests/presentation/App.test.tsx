import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/presentation/App'
import type { StorageHooks } from '@/infrastructure/idbStorage'
import { adoptPuppy } from '@/application/adoption'
import { fakeHistory } from './fakeHistory'
import { createFakePreview, createFakeStage, savingStorage } from './fakeStage'

const ASK = 'Pulsa atrás otra vez para salir'

describe('App', () => {
  it('starts at adoption when there are no puppies', async () => {
    render(
      <App
        openStorage={async () => savingStorage()}
        createStage={createFakeStage().create}
        createPreview={createFakePreview().create}
      />,
    )
    expect(await screen.findByRole('heading', { name: 'Adopta un cachorro' })).toBeInTheDocument()
  })

  it('starts in the room when there are puppies', async () => {
    const storage = savingStorage()
    await adoptPuppy(
      storage,
      { name: 'Kuma', breedId: 'shiba' },
      { now: () => 1, random: () => 0.5 },
    )
    render(
      <App
        openStorage={async () => storage}
        createStage={createFakeStage().create}
        createPreview={createFakePreview().create}
      />,
    )
    expect(await screen.findByRole('heading', { name: 'Kuma' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Adopta un cachorro' })).not.toBeInTheDocument()
  })

  it('asks to close the other tabs while the storage waits on them, and reloads when asked to', async () => {
    let hooks: StorageHooks | undefined
    let reloads = 0
    render(
      <App
        openStorage={(h) => {
          hooks = h
          return new Promise(() => {})
        }}
        reload={() => void reloads++}
        createStage={createFakeStage().create}
        createPreview={createFakePreview().create}
      />,
    )
    expect(screen.queryByText('Cierra las otras pestañas de Patitas')).not.toBeInTheDocument()
    act(() => hooks!.blocked())
    expect(await screen.findByText('Cierra las otras pestañas de Patitas')).toBeInTheDocument()
    hooks!.reload()
    expect(reloads).toBe(1)
  })

  it('asks before leaving on the system back when there is only adoption', async () => {
    const tab = fakeHistory()
    render(
      <App
        openStorage={async () => savingStorage()}
        createStage={createFakeStage().create}
        createPreview={createFakePreview().create}
        history={tab}
      />,
    )
    await screen.findByRole('heading', { name: 'Adopta un cachorro' })
    expect(tab.entries()).toEqual([null, { patitas: 'guard' }])
    tab.history.back()
    expect(screen.getByText(ASK)).toHaveAttribute('role', 'status')
    expect(tab.entries()).toEqual([null])
    tab.history.back()
    expect(tab.left()).toBe(true)
  })

  it('goes back from adopting to the room, and every back after a round trip is answered', async () => {
    const user = userEvent.setup()
    const storage = savingStorage()
    await adoptPuppy(
      storage,
      { name: 'Kuma', breedId: 'shiba' },
      { now: () => 1, random: () => 0.5 },
    )
    const tab = fakeHistory()
    render(
      <App
        openStorage={async () => storage}
        createStage={createFakeStage().create}
        createPreview={createFakePreview().create}
        history={tab}
      />,
    )
    const guard = { patitas: 'guard' }
    const adopt = async () => {
      await user.click(await screen.findByRole('button', { name: 'Cachorros' }, { timeout: 3000 }))
      await user.click(screen.getByRole('button', { name: 'Adoptar otro' }))
      expect(screen.getByRole('heading', { name: 'Adopta un cachorro' })).toBeInTheDocument()
    }

    for (let trip = 0; trip < 3; trip++) {
      // The system back and «Volver a la sala» both return to the room
      await adopt()
      tab.history.back()
      expect(await screen.findByRole('heading', { name: 'Kuma' })).toBeInTheDocument()
      expect(screen.queryByText(ASK)).not.toBeInTheDocument()
      expect(tab.entries()).toEqual([null, guard])
      await adopt()
      await user.click(screen.getByRole('button', { name: 'Volver a la sala' }))
      expect(await screen.findByRole('heading', { name: 'Kuma' })).toBeInTheDocument()
      expect(tab.length()).toBeLessThanOrEqual(3)
    }

    // Back in the room with nothing open, the back asks: none goes by unanswered
    tab.history.back()
    expect(screen.getByText(ASK)).toBeInTheDocument()
    expect(tab.left()).toBe(false)
    tab.history.back()
    expect(tab.left()).toBe(true)
  })
})
