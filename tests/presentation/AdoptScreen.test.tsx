import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/presentation/App'
import { createMemoryStorage } from '@/infrastructure/memoryStorage'
import type { GameStorage } from '@/infrastructure/storage'
import { createFakeStage, savingStorage } from './fakeStage'

const start = (storage: GameStorage) => {
  const stage = createFakeStage()
  render(<App openStorage={async () => storage} createStage={stage.create} />)
  return stage
}

describe('AdoptScreen', () => {
  it('adopts a named shiba and opens the room with it', async () => {
    const user = userEvent.setup()
    const storage = savingStorage()
    const stage = start(storage)

    expect(await screen.findByRole('heading', { name: 'Adopta un cachorro' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Shiba/ }))
    await user.type(screen.getByLabelText('Nombre'), 'Kuma')
    await user.click(screen.getByRole('button', { name: 'Adoptar' }))

    expect(await screen.findByRole('button', { name: 'Adoptar otro' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kuma' })).toBeInTheDocument()
    await waitFor(() => expect(stage.names()).toEqual(['Kuma']))
    const saved = await storage.listPuppies()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: 'Kuma', breedId: 'shiba' })
    expect(screen.queryByText(/No se puede guardar/)).not.toBeInTheDocument()
  })

  it('asks for a name and saves nothing when it is empty', async () => {
    const user = userEvent.setup()
    const storage = savingStorage()
    start(storage)

    await user.click(await screen.findByRole('button', { name: 'Adoptar' }))

    expect(await screen.findByText('Ponle un nombre de 1 a 20 letras.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true')
    expect(await storage.listPuppies()).toEqual([])
    expect(screen.getByRole('heading', { name: 'Adopta un cachorro' })).toBeInTheDocument()
  })

  it('warns that nothing is kept when the browser cannot save', async () => {
    start(createMemoryStorage())

    expect(
      await screen.findByText(
        'No se puede guardar en este navegador; tus cachorros se perderán al cerrar.',
      ),
    ).toBeInTheDocument()
  })
})
