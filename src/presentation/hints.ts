import type { HintKey } from '@/engine/puppy/behaviour'

export const HINTS: Record<Exclude<HintKey, 'sleep'>, string> = {
  idle: 'Toca el suelo y irá hacia allí. Desliza sobre él para acariciarlo.',
  head: 'Le encanta que le rasques la cabeza.',
  ears: 'Detrás de las orejas es su punto débil.',
  muzzle: 'Te está olisqueando la mano.',
  chest: 'Levanta la barbilla para que sigas.',
  back: 'Acariciándole el lomo…',
  scratch: '¡Mira cómo mueve la pata!',
  belly: '¡Le encanta que le rasques la barriga!',
  sit: 'Sentado, muy formal.',
  lie: 'Tumbado, descansando. Ráscale el lomo o la barriga.',
  'belly-up': '¡Panza arriba! Ráscale la barriga.',
  wait: 'Desliza el dedo hacia arriba para lanzarla.',
  chase: '¡Allá va!',
  bringing: 'Te la trae…',
  done: '¡Muy bien! Toca la pelota para volver a lanzarla.',
}

export const NIGHT_HINT = 'Es de noche: tus cachorros duermen.'

/** The hint for `key` about the puppy called `name`. */
export const hintText = (key: HintKey, name: string): string =>
  key === 'sleep' ? `${name} está durmiendo. Tócalo para despertarlo.` : HINTS[key]
