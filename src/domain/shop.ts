import type { Wallet } from './wallet'

/** A special food for the bowl: on top of the meal, its own effect. */
export type FoodId = 'premium' | 'light' | 'energy'

/** What goes once used. */
export type Consumable = FoodId

export type ItemId = Consumable

export type Aisle = 'food'

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

export const AISLES: { id: Aisle; name: string }[] = [{ id: 'food', name: 'Comida' }]

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
]

export const itemOf = (id: ItemId): Item => SHOP.find((i) => i.id === id)!

/** The wallet with `id` bought, or null when the coins do not reach. */
export function buy(wallet: Wallet, id: ItemId): Wallet | null {
  const { price } = itemOf(id)
  if (wallet.coins < price) return null
  return {
    ...wallet,
    coins: wallet.coins - price,
    stock: { ...wallet.stock, [id]: (wallet.stock[id] ?? 0) + 1 },
  }
}

/** The wallet with one `id` used up, or null when there is none left. */
export function spendOne(wallet: Wallet, id: Consumable): Wallet | null {
  const left = wallet.stock[id] ?? 0
  if (left < 1) return null
  return { ...wallet, stock: { ...wallet.stock, [id]: left - 1 } }
}
