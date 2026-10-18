import { lazy, Suspense } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import App from './App'

const DebugPuppy = lazy(() => import('./DebugPuppy'))

const asBreed = (id: string | null): BreedId | null => (id && id in BREEDS ? (id as BreedId) : null)

function debugBreeds(search: string): BreedId[] | null {
  const params = new URLSearchParams(search)
  if (params.get('debug') !== 'puppy') return null
  const second = asBreed(params.get('breed2'))
  return [asBreed(params.get('breed')) ?? 'dorado', ...(second ? [second] : [])]
}

/** The app, or with `?debug=puppy&breed=…[&breed2=…]` one or two puppies for checking the render. */
export default function Root({ search }: { search: string }) {
  const breeds = debugBreeds(search)
  if (!breeds) return <App />
  return (
    <Suspense>
      <DebugPuppy breedIds={breeds} />
    </Suspense>
  )
}
