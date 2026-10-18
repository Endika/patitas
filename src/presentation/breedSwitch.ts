import type { BreedId } from '@/domain/breeds'

export interface BreedSwitchPorts<G> {
  load(id: BreedId): Promise<G>
  /** The breed's mesh if it is already built, to mount without a loading flash. */
  peek(id: BreedId): G | undefined
  mount(id: BreedId, built: G): void
  /** Takes away the puppy mounted last. */
  unmount(): void
  status(s: { loading: boolean; failed: boolean }): void
}

/** One puppy at a time: each `show` replaces the last, and a mesh for a breed no longer wanted is dropped. */
export function createBreedSwitch<G>(ports: BreedSwitchPorts<G>) {
  let wanted: BreedId | null = null
  let shown: BreedId | null = null
  let failed = false
  let stopped = false

  const mount = (id: BreedId, built: G) => {
    shown = id
    ports.mount(id, built)
    ports.status({ loading: false, failed: false })
  }

  return {
    show(id: BreedId) {
      if (stopped || (id === wanted && !failed)) return
      wanted = id
      failed = false
      if (shown) {
        ports.unmount()
        shown = null
      }
      const ready = ports.peek(id)
      if (ready) return mount(id, ready)
      ports.status({ loading: true, failed: false })
      ports.load(id).then(
        (built) => {
          if (!stopped && id === wanted && shown !== id) mount(id, built)
        },
        () => {
          if (stopped || id !== wanted || shown === id) return
          failed = true
          ports.status({ loading: false, failed: true })
        },
      )
    },
    stop() {
      stopped = true
    },
  }
}
