import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './presentation/Root'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root search={location.search} />
  </StrictMode>,
)
