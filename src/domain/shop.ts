import type { Wallet } from './wallet'

/** A special food for the bowl: on top of the meal, its own effect. */
export type FoodId = 'premium' | 'light' | 'energy'

/** What can be thrown for them: the ball everyone has, or a toy bought. */
export type ToyId = 'ball' | 'bone' | 'plush'

/** What goes once used. */
export type Consumable = FoodId | 'treat'

/** What is kept once bought. */
export type Keepsake = Exclude<ToyId, 'ball'>

export type ItemId = Consumable | Keepsake

export type Aisle = 'food' | 'treat' | 'toy'

export interface Item {
  id: ItemId
  aisle: Aisle
  name: string
  /** The name on a button with no room for the whole of it. */
  short: string
  price: number
  /** What it does, in a few words. */
  blurb: string
}

export const AISLES: { id: Aisle; name: string }[] = [
  { id: 'food', name: 'Comida' },
  { id: 'treat', name: 'Chuches' },
  { id: 'toy', name: 'Juguetes' },
]

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
  {
    id: 'bone',
    aisle: 'toy',
    name: 'Hueso',
    short: 'Hueso',
    price: 40,
    blurb: 'Bota poco y se lo lleva atravesado en la boca.',
  },
  {
    id: 'plush',
    aisle: 'toy',
    name: 'Peluche',
    short: 'Peluche',
    price: 60,
    blurb: 'Blandito: cae y apenas rueda.',
  },
]

/** Whether `id` is kept once bought rather than used up. */
export const isKeepsake = (id: ItemId): id is Keepsake => id === 'bone' || id === 'plush'

export const itemOf = (id: ItemId): Item => SHOP.find((i) => i.id === id)!

/**
 * The wallet with `id` bought, or null when the coins do not reach or it is a keepsake already
 * owned.
 */
export function buy(wallet: Wallet, id: ItemId): Wallet | null {
  const { price } = itemOf(id)
  if (wallet.coins < price) return null
  if (isKeepsake(id)) {
    if (wallet.owned.includes(id)) return null
    return { ...wallet, coins: wallet.coins - price, owned: [...wallet.owned, id] }
  }
  return {
    ...wallet,
    coins: wallet.coins - price,
    stock: { ...wallet.stock, [id]: (wallet.stock[id] ?? 0) + 1 },
  }
}

/** The toy the ball button throws, if it is the ball or one owned. */
export function chooseToy(wallet: Wallet, toy: ToyId): Wallet | null {
  if (toy !== 'ball' && !wallet.owned.includes(toy)) return null
  return { ...wallet, toy }
}

/** The wallet with one `id` used up, or null when there is none left. */
export function spendOne(wallet: Wallet, id: Consumable): Wallet | null {
  const left = wallet.stock[id] ?? 0
  if (left < 1) return null
  return { ...wallet, stock: { ...wallet.stock, [id]: left - 1 } }
}
