import { render, screen } from '@testing-library/react'
import App from '@/presentation/App'
import { adoptPuppy } from '@/application/adoption'
import { createFakeStage, savingStorage } from './fakeStage'

describe('App', () => {
  it('starts at adoption when there are no puppies', async () => {
    render(<App openStorage={async () => savingStorage()} createStage={createFakeStage().create} />)
    expect(await screen.findByRole('heading', { name: 'Adopta un cachorro' })).toBeInTheDocument()
  })

  it('starts in the room when there are puppies', async () => {
    const storage = savingStorage()
    await adoptPuppy(
      storage,
      { name: 'Kuma', breedId: 'shiba' },
      { now: () => 1, random: () => 0.5 },
    )
    render(<App openStorage={async () => storage} createStage={createFakeStage().create} />)
    expect(await screen.findByRole('heading', { name: 'Kuma' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Adopta un cachorro' })).not.toBeInTheDocument()
  })
})
