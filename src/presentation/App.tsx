import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { openGameStorage, type StorageHooks } from '@/infrastructure/idbStorage'
import type { GameStorage } from '@/infrastructure/storage'
import type { RoomStage } from './roomStage'
import type { CreatePreview } from './components/AdoptPreview'
import type { Closable } from './components/useDismiss'
import AdoptScreen from './screens/AdoptScreen'
import { EXIT_MS, useBackGuard, type BackGuardHistory } from './useBackGuard'
import { useFleeting } from './useFleeting'
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
  history,
}: {
  openStorage?: (hooks: StorageHooks) => Promise<GameStorage>
  /** Starts the page over, for when another tab needs to upgrade the storage. */
  reload?: () => void
  /** Wall-clock milliseconds, for the time a puppy was away. */
  now?: () => number
  createStage?: (canvas: HTMLCanvasElement) => RoomStage
  createPreview?: CreatePreview
  /** Where the system back arrives; the page's own history unless a test brings its own. */
  history?: BackGuardHistory
}) {
  const [blocked, setBlocked] = useState(false)
  const open = useCallback(
    () => openStorage({ blocked: () => setBlocked(true), reload }),
    [openStorage, reload],
  )
  const game = useGame(open, now)
  const [adopting, setAdopting] = useState(false)
  // A puppy adopted into a full room, until the player moves someone
  const [outside, setOutside] = useState<string | null>(null)

  // One guard keeps the system back in the app: adopting goes back to the room, and the room
  // closes what is open, before it asks to leave
  const roomScreen = useRef<Closable>(null)
  const returnable = adopting && !!game.state?.puppies.length
  const closeTop = () => {
    if (returnable) {
      setAdopting(false)
      return true
    }
    return roomScreen.current?.close() ?? false
  }
  // Armed once the game has loaded: a back on the blank screen before it leaves as it would
  const guard = useBackGuard(closeTop, history, !!game.state)
  const exitAsked = useFleeting(guard.asked || null, EXIT_MS) !== null
  const { rearm } = guard
  useEffect(() => {
    if (adopting) rearm()
  }, [adopting, rearm])

  if (!game.state) return <Blank blocked={blocked} />
  const { puppies, room, persistent, wallet } = game.state

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
        exitAsked={exitAsked}
      />
    )
  return (
    <Suspense fallback={<Blank />}>
      <RoomScreen
        ref={roomScreen}
        exitAsked={exitAsked}
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
        onOpen={rearm}
        loadCare={game.loadCare}
        saveCare={game.saveCare}
        wallet={wallet}
        onDeed={game.earn}
        onBuy={game.buy}
        onSpend={game.spend}
        onTeach={game.teach}
        onToy={game.toy}
        now={now}
        createStage={createStage}
      />
    </Suspense>
  )
}
