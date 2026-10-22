import { BREEDS, type BreedId } from '@/domain/breeds'
import { buildPuppyGeometry } from './geometry'
import { packPuppyGeometry } from './geometryPack'

self.onmessage = (e: MessageEvent<unknown>) => {
  if (typeof e.data !== 'string' || !Object.hasOwn(BREEDS, e.data)) {
    throw new Error(`Unknown breed: ${String(e.data)}`)
  }
  const { packed, transfer } = packPuppyGeometry(buildPuppyGeometry(BREEDS[e.data as BreedId]))
  self.postMessage(packed, { transfer })
}
