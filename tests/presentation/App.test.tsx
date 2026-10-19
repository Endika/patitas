import { act, render, screen } from '@testing-library/react'
import App from '@/presentation/App'
import type { StorageHooks } from '@/infrastructure/idbStorage'
import { adoptPuppy } from '@/application/adoption'
import { createFakePreview, createFakeStage, savingStorage } from './fakeStage'

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
})
