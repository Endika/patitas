import { render, screen } from '@testing-library/react'
import Root from '@/presentation/Root'

describe('Root', () => {
  it('only takes a debug breed that is one of the breeds', async () => {
    render(<Root search="?debug=puppy&breed=constructor" />)
    expect(await screen.findByText('Canela')).toBeInTheDocument()
    expect(
      await screen.findByText('Este navegador no puede mostrar gráficos 3D.'),
    ).toBeInTheDocument()
  })
})
