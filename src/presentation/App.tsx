import { lazy, Suspense, useState } from 'react'
import { openGameStorage } from '@/infrastructure/idbStorage'
import type { GameStorage } from '@/infrastructure/storage'
import type { RoomStage } from './roomStage'
import AdoptScreen from './screens/AdoptScreen'
import { useGame } from './useGame'

// The room brings three.js: it loads only once there is a puppy to show
const RoomScreen = lazy(() => import('./screens/RoomScreen'))

const Blank = () => <main aria-busy="true" className="min-h-dvh bg-ground" />

/** Adoption when there are no puppies, the room when there are. */
export default function App({
  openStorage = openGameStorage,
  createStage,
}: {
  openStorage?: () => Promise<GameStorage>
  createStage?: (canvas: HTMLCanvasElement) => RoomStage
}) {
  const game = useGame(openStorage)
  const [adopting, setAdopting] = useState(false)
  if (!game.state) return <Blank />
  const { puppies, room, persistent } = game.state

  if (adopting || !puppies.length)
    return (
      <AdoptScreen
        unsaved={!persistent}
        onAdopt={async (input) => {
          await game.adopt(input)
          setAdopting(false)
        }}
        onBack={puppies.length ? () => setAdopting(false) : undefined}
      />
    )
  return (
    <Suspense fallback={<Blank />}>
      <RoomScreen
        puppies={puppies}
        room={room}
        unsaved={!persistent}
        onEnter={game.enter}
        onLeave={game.leave}
        onAdoptAnother={() => setAdopting(true)}
        createStage={createStage}
      />
    </Suspense>
  )
}
