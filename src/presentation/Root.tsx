import { lazy, Suspense } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import App from './App'

const DebugPuppy = lazy(() => import('./DebugPuppy'))

function debugBreed(search: string): BreedId | null {
  const params = new URLSearchParams(search)
  if (params.get('debug') !== 'puppy') return null
  const breed = params.get('breed')
  return breed && breed in BREEDS ? (breed as BreedId) : 'dorado'
}

/** The app, or with `?debug=puppy&breed=…` a single puppy for checking the render. */
export default function Root({ search }: { search: string }) {
  const breed = debugBreed(search)
  if (!breed) return <App />
  return (
    <Suspense>
      <DebugPuppy breedId={breed} />
    </Suspense>
  )
}
