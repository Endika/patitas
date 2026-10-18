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
  // A puppy adopted into a full room, until the player moves someone
  const [outside, setOutside] = useState<string | null>(null)
  if (!game.state) return <Blank />
  const { puppies, room, persistent } = game.state

  if (adopting || !puppies.length)
    return (
      <AdoptScreen
        unsaved={!persistent}
        onAdopt={async (input) => {
          const { puppy, entered } = await game.adopt(input)
          setOutside(entered ? null : puppy.name)
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
        outside={outside}
        onEnter={(id) => {
          setOutside(null)
          return game.enter(id)
        }}
        onLeave={(id) => {
          setOutside(null)
          return game.leave(id)
        }}
        onAdoptAnother={() => setAdopting(true)}
        createStage={createStage}
      />
    </Suspense>
  )
}
