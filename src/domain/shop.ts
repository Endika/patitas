import type { Wallet } from './wallet'

/** A special food for the bowl: on top of the meal, its own effect. */
export type FoodId = 'premium' | 'light' | 'energy'

/** What goes once used. */
export type Consumable = FoodId | 'treat'

/** Each kind of thing kept and chosen to use, and the looks it comes in, the standard one first. */
export const LOOKS = {
  toy: ['ball', 'bone', 'plush'],
  bed: ['coral', 'sage', 'sky'],
  bowl: ['ink', 'cherry', 'teal'],
  rug: ['rose', 'sky', 'sand'],
  collar: ['red', 'blue', 'gold'],
} as const

export type Slot = keyof typeof LOOKS
export type Look<S extends Slot> = (typeof LOOKS)[S][number]

/** What can be thrown for them: the ball everyone has, or a toy bought. */
export type ToyId = Look<'toy'>

/** A collar's colour: each puppy wears its own, or none. */
export type CollarLook = Look<'collar'>

/** The colours the room's things are in. */
export interface Decor {
  bed: Look<'bed'>
  bowl: Look<'bowl'>
  rug: Look<'rug'>
}

export const STANDARD_DECOR: Decor = { bed: 'coral', bowl: 'ink', rug: 'rose' }

/** What is kept once bought, or comes with the house, and is chosen to use. */
export type Keepsake =
  | ToyId
  | `bed-${Look<'bed'>}`
  | `bowl-${Look<'bowl'>}`
  | `rug-${Look<'rug'>}`
  | `collar-${CollarLook}`

export type ItemId = Consumable | Keepsake

export type Aisle = 'food' | 'treat' | 'toy' | 'room' | 'collar'

export interface Item {
  id: ItemId
  aisle: Aisle
  name: string
  /** The name on a button with no room for the whole of it. */
  short: string
  /** 0 for what comes with the house. */
  price: number
  /** What it does, in a few words. */
  blurb: string
  /** A keepsake: the slot it fills when chosen, and as which look. */
  use?: { slot: Slot; look: string }
}

export const AISLES: { id: Aisle; name: string }[] = [
  { id: 'food', name: 'Comida' },
  { id: 'treat', name: 'Chuches' },
  { id: 'toy', name: 'Juguetes' },
  { id: 'room', name: 'Sala' },
  { id: 'collar', name: 'Collares' },
]

const keepsake = (
  slot: Slot,
  look: string,
  name: string,
  price: number,
  blurb: string,
  aisle: Aisle = slot === 'toy' || slot === 'collar' ? slot : 'room',
): Item => ({
  id: (slot === 'toy' ? look : `${slot}-${look}`) as Keepsake,
  aisle,
  name,
  short: name,
  price,
  blurb,
  use: { slot, look },
})

export const SHOP: Item[] = [
  {
    id: 'premium',
    aisle: 'food',
    name: 'Pienso premium',
    short: 'Premium',
    price: 15,
    blurb: 'Le pone contento y le deja el pelo brillante.',
  },
  {
    id: 'light',
    aisle: 'food',
    name: 'Comida ligera',
    short: 'Ligera',
    price: 10,
    blurb: 'Engorda la mitad.',
  },
  {
    id: 'energy',
    aisle: 'food',
    name: 'Comida energética',
    short: 'Energética',
    price: 12,
    blurb: 'Le devuelve energía para jugar.',
  },
  {
    id: 'treat',
    aisle: 'treat',
    name: 'Chuche',
    short: 'Chuche',
    price: 4,
    blurb: 'Dásela justo después de un truco y lo aprenderá antes.',
  },
  keepsake('toy', 'ball', 'Pelota', 0, 'La de siempre: bota y rueda.'),
  keepsake('toy', 'bone', 'Hueso', 40, 'Bota poco y se lo lleva atravesado en la boca.'),
  keepsake('toy', 'plush', 'Peluche', 60, 'Blandito: cae y apenas rueda.'),
  keepsake('bed', 'coral', 'Camas coral', 0, 'Las de siempre.'),
  keepsake('bed', 'sage', 'Camas salvia', 30, 'Verde suave, con cojín claro.'),
  keepsake('bed', 'sky', 'Camas cielo', 30, 'Azul tranquilo, con cojín claro.'),
  keepsake('bowl', 'ink', 'Cuencos oscuros', 0, 'Los de siempre.'),
  keepsake('bowl', 'cherry', 'Cuencos cereza', 20, 'Rojo brillante.'),
  keepsake('bowl', 'teal', 'Cuencos turquesa', 20, 'Verde azulado brillante.'),
  keepsake('rug', 'rose', 'Alfombra rosa', 0, 'La de siempre.'),
  keepsake('rug', 'sky', 'Alfombra azul', 25, 'Azul empolvado.'),
  keepsake('rug', 'sand', 'Alfombra arena', 25, 'Color miel.'),
  keepsake('collar', 'red', 'Collar rojo', 25, 'Para el cachorro que elijas.'),
  keepsake('collar', 'blue', 'Collar azul', 25, 'Para el cachorro que elijas.'),
  keepsake('collar', 'gold', 'Collar dorado', 25, 'Para el cachorro que elijas.'),
]

export const itemOf = (id: ItemId): Item => SHOP.find((i) => i.id === id)!

/** Whether `id` is kept once bought, or comes with the house, rather than used up. */
export const isKeepsake = (id: ItemId): id is Keepsake => !!itemOf(id).use

/** Whether the house has `id` to use: it came with it or was bought. */
export const owns = (wallet: Wallet, id: Keepsake): boolean =>
  itemOf(id).price === 0 || wallet.owned.includes(id)

/** Whether `id` is the one in use in its slot; a collar is each puppy's, never the house's. */
export function inUse(wallet: Wallet, id: Keepsake): boolean {
  const { slot, look } = itemOf(id).use!
  if (slot === 'collar') return false
  return (slot === 'toy' ? wallet.toy : wallet.decor[slot]) === look
}

/**
 * The wallet with `id` bought, or null when the coins do not reach or it is a keepsake the house
 * already has.
 */
export function buy(wallet: Wallet, id: ItemId): Wallet | null {
  const { price } = itemOf(id)
  if (wallet.coins < price) return null
  if (isKeepsake(id)) {
    if (owns(wallet, id)) return null
    return { ...wallet, coins: wallet.coins - price, owned: [...wallet.owned, id] }
  }
  return {
    ...wallet,
    coins: wallet.coins - price,
    stock: { ...wallet.stock, [id]: (wallet.stock[id] ?? 0) + 1 },
  }
}

/**
 * The wallet with `id` in use in its slot, or null when the house does not have it or it is a
 * collar, which a puppy wears instead.
 */
export function choose(wallet: Wallet, id: Keepsake): Wallet | null {
  if (!owns(wallet, id)) return null
  const { slot, look } = itemOf(id).use!
  if (slot === 'collar') return null
  if (slot === 'toy') return { ...wallet, toy: look as ToyId }
  return { ...wallet, decor: { ...wallet.decor, [slot]: look } }
}

/** The wallet with one `id` used up, or null when there is none left. */
export function spendOne(wallet: Wallet, id: Consumable): Wallet | null {
  const left = wallet.stock[id] ?? 0
  if (left < 1) return null
  return { ...wallet, stock: { ...wallet.stock, [id]: left - 1 } }
}
