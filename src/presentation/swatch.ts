import { BREEDS, type BreedId } from '@/domain/breeds'

/** A soft swatch of the breed's coat colours. */
export const swatch = (id: BreedId) => {
  const colours = Object.values(BREEDS[id].palette)
  return `linear-gradient(135deg, ${colours.join(', ')})`
}
