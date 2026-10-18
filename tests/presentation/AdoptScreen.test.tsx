import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/presentation/App'
import { createMemoryStorage } from '@/infrastructure/memoryStorage'
import type { GameStorage } from '@/infrastructure/storage'
import { createFakePreview, createFakeStage, savingStorage } from './fakeStage'

const start = (storage: GameStorage) => {
  const stage = createFakeStage()
  const preview = createFakePreview()
  const view = render(
    <App
      openStorage={async () => storage}
      createStage={stage.create}
      createPreview={preview.create}
    />,
  )
  return { ...stage, preview, unmount: view.unmount }
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

  describe('preview', () => {
    it('shows the chosen breed and follows the choice', async () => {
      const user = userEvent.setup()
      const { preview } = start(savingStorage())

      expect(await screen.findByLabelText('Vista previa del cachorro Dorado')).toBeInTheDocument()
      expect(preview.calls).toEqual(['show:dorado'])
      await user.click(screen.getByRole('radio', { name: /Shiba/ }))

      expect(preview.calls).toEqual(['show:dorado', 'show:shiba'])
      expect(screen.getByLabelText('Vista previa del cachorro Shiba')).toBeInTheDocument()
    })

    it('ends on the last breed chosen when the choice changes quickly', async () => {
      const user = userEvent.setup()
      const { preview } = start(savingStorage())

      await user.click(await screen.findByRole('radio', { name: /Shiba/ }))
      await user.click(screen.getByRole('radio', { name: /Beagle/ }))

      expect(preview.calls).toEqual(['show:dorado', 'show:shiba', 'show:beagle'])
    })

    it('says it is getting the puppy ready until the stage has it', async () => {
      const { preview } = start(savingStorage())

      expect(await screen.findByText('Preparando al cachorro…')).toBeInTheDocument()
      preview.emit({ loading: false })
      await waitFor(() =>
        expect(screen.queryByText('Preparando al cachorro…')).not.toBeInTheDocument(),
      )
      preview.emit({ notice: 'No se pudo preparar al cachorro.' })
      expect(await screen.findByText('No se pudo preparar al cachorro.')).toBeInTheDocument()
    })

    it('lets the player adopt while the preview is still loading, then lets it go once', async () => {
      const user = userEvent.setup()
      const { preview } = start(savingStorage())

      await user.type(await screen.findByLabelText('Nombre'), 'Txiki')
      await user.click(screen.getByRole('button', { name: 'Adoptar' }))

      expect(await screen.findByRole('heading', { name: 'Txiki' })).toBeInTheDocument()
      expect(preview.calls.filter((c) => c === 'dispose')).toHaveLength(1)
      expect(preview.canvases.some((c) => c.isConnected)).toBe(false)
    })

    it('lets the preview go once when the screen goes away', async () => {
      const { preview, unmount } = start(savingStorage())
      await screen.findByLabelText('Vista previa del cachorro Dorado')

      unmount()
      expect(preview.calls.filter((c) => c === 'dispose')).toHaveLength(1)
    })

    it('gives every preview a canvas of its own under StrictMode', async () => {
      const preview = createFakePreview()
      const { unmount } = render(
        <StrictMode>
          <App
            openStorage={async () => savingStorage()}
            createStage={createFakeStage().create}
            createPreview={preview.create}
          />
        </StrictMode>,
      )
      await screen.findByLabelText('Vista previa del cachorro Dorado')

      const { canvases } = preview
      expect(canvases).toHaveLength(2)
      expect(new Set(canvases).size).toBe(2)
      expect(canvases.filter((c) => c.isConnected)).toEqual([canvases.at(-1)])
      expect(preview.calls.filter((c) => c === 'dispose')).toHaveLength(1)
      unmount()
      expect(preview.calls.filter((c) => c === 'dispose')).toHaveLength(2)
    })
  })
})
