import { BREEDS, type BreedId } from '@/domain/breeds'
import { buildPuppyGeometry } from './geometry'
import { packPuppyGeometry } from './geometryPack'

self.onmessage = (e: MessageEvent<BreedId>) => {
  const { packed, transfer } = packPuppyGeometry(buildPuppyGeometry(BREEDS[e.data]))
  self.postMessage(packed, { transfer })
}
