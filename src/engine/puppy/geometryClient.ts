import { BREEDS, type BreedId } from '@/domain/breeds'
import { buildPuppyGeometry, type PuppyGeometry } from './geometry'
import { unpackPuppyGeometry, type PackedPuppyGeometry } from './geometryPack'

const loading = new Map<BreedId, Promise<PuppyGeometry>>()
const ready = new Map<BreedId, PuppyGeometry>()
let warned = false

/** On the main thread the build blocks for a couple of seconds: let a notice paint first. */
const buildHere = (id: BreedId) =>
  new Promise<PuppyGeometry>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(buildPuppyGeometry(BREEDS[id]))
      } catch (err) {
        reject(err as Error)
      }
    }, 40),
  )

function fallBack(id: BreedId, why: unknown): Promise<PuppyGeometry> {
  if (import.meta.env.DEV && !warned) {
    warned = true
    console.warn('Puppy worker failed; meshing on the main thread', why)
  }
  return buildHere(id)
}

function buildInWorker(id: BreedId): Promise<PuppyGeometry> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
  } catch (err) {
    return fallBack(id, err)
  }
  return new Promise<PuppyGeometry>((resolve) => {
    const done = (result: Promise<PuppyGeometry> | PuppyGeometry) => {
      worker.terminate()
      resolve(result)
    }
    worker.onmessage = (e: MessageEvent<PackedPuppyGeometry>) => done(unpackPuppyGeometry(e.data))
    worker.onerror = (e) => {
      e.preventDefault()
      done(fallBack(id, e.message))
    }
    worker.onmessageerror = (e) => done(fallBack(id, e))
    worker.postMessage(id)
  })
}

/** Meshing a breed takes 1.5–2 s, so each breed is built once, off the main thread when it can. */
export function loadPuppyGeometry(id: BreedId): Promise<PuppyGeometry> {
  let p = loading.get(id)
  if (!p) {
    p = (typeof Worker !== 'undefined' ? buildInWorker(id) : buildHere(id)).then(
      (g) => {
        ready.set(id, g)
        return g
      },
      (err: unknown) => {
        loading.delete(id)
        throw err
      },
    )
    loading.set(id, p)
  }
  return p
}

/** The breed's geometry if it has already been built. */
export const peekPuppyGeometry = (id: BreedId): PuppyGeometry | undefined => ready.get(id)
