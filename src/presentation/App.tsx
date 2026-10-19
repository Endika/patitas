import { lazy, Suspense, useCallback, useState } from 'react'
import { openGameStorage, type StorageHooks } from '@/infrastructure/idbStorage'
import type { GameStorage } from '@/infrastructure/storage'
import type { RoomStage } from './roomStage'
import type { CreatePreview } from './components/AdoptPreview'
import AdoptScreen from './screens/AdoptScreen'
import { useGame } from './useGame'

// The room brings three.js: it loads only once there is a puppy to show
const RoomScreen = lazy(() => import('./screens/RoomScreen'))

const Blank = ({ blocked = false }: { blocked?: boolean }) => (
  <main aria-busy="true" className="min-h-dvh bg-ground">
    {blocked && <p role="status">Cierra las otras pestañas de Patitas</p>}
  </main>
)

const reloadPage = () => window.location.reload()

/** Adoption when there are no puppies, the room when there are. */
export default function App({
  openStorage = openGameStorage,
  createStage,
  createPreview,
  now,
  reload = reloadPage,
}: {
  openStorage?: (hooks: StorageHooks) => Promise<GameStorage>
  /** Starts the page over, for when another tab needs to upgrade the storage. */
  reload?: () => void
  /** Wall-clock milliseconds, for the time a puppy was away. */
  now?: () => number
  createStage?: (canvas: HTMLCanvasElement) => RoomStage
  createPreview?: CreatePreview
}) {
  const [blocked, setBlocked] = useState(false)
  const open = useCallback(
    () => openStorage({ blocked: () => setBlocked(true), reload }),
    [openStorage, reload],
  )
  const game = useGame(open)
  const [adopting, setAdopting] = useState(false)
  // A puppy adopted into a full room, until the player moves someone
  const [outside, setOutside] = useState<string | null>(null)
  if (!game.state) return <Blank blocked={blocked} />
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
        createPreview={createPreview}
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
        loadCare={game.loadCare}
        saveCare={game.saveCare}
        now={now}
        createStage={createStage}
      />
    </Suspense>
  )
}
