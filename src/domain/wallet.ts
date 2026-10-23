import type { Consumable, Keepsake, ToyId } from './shop'

/** Something done for the puppies that earns coins. */
export type Deed = 'meal' | 'bath' | 'brush' | 'clean' | 'fetch' | 'trick'

/** What each deed earns, and how many times a day it does. */
export const PAY: Record<Deed, { coins: number; times: number }> = {
  meal: { coins: 5, times: 3 },
  bath: { coins: 10, times: 2 },
  brush: { coins: 5, times: 3 },
  clean: { coins: 3, times: 6 },
  fetch: { coins: 2, times: 10 },
  trick: { coins: 2, times: 10 },
}

/** Coins the whole house can earn in a day. */
export const DAILY_CAP = 100
export const START_COINS = 50

export interface Wallet {
  coins: number
  /** The local day the counts below are for, as YYYY-MM-DD. */
  day: string
  /** Coins earned that day. */
  earned: number
  /** Times each deed has paid that day. */
  paid: Partial<Record<Deed, number>>
  /** How many of each thing bought to use up are left. */
  stock: Partial<Record<Consumable, number>>
  /** What has been bought to keep. */
  owned: Keepsake[]
  /** What the ball button throws. */
  toy: ToyId
}

export function dayOf(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const createWallet = (now: number): Wallet => ({
  coins: START_COINS,
  day: dayOf(now),
  earned: 0,
  paid: {},
  stock: {},
  owned: [],
  toy: 'ball',
})

/** A wallet saved before the shop or the toys: nothing bought yet, and the ball to throw. */
export const withWalletDefaults = (
  stored: Omit<Wallet, 'stock' | 'owned' | 'toy'> & Partial<Wallet>,
): Wallet => ({
  stock: {},
  owned: [],
  toy: 'ball',
  ...stored,
})

/** The deed's pay, within its times a day and what is left of the day's cap; a new day starts afresh. */
export function earn(wallet: Wallet, deed: Deed, now: number): { wallet: Wallet; gained: number } {
  const day = dayOf(now)
  const today = day === wallet.day ? wallet : { ...wallet, day, earned: 0, paid: {} }
  const times = today.paid[deed] ?? 0
  const gained =
    times < PAY[deed].times ? Math.min(PAY[deed].coins, Math.max(0, DAILY_CAP - today.earned)) : 0
  if (!gained) return { wallet: today, gained }
  return {
    wallet: {
      ...today,
      coins: today.coins + gained,
      earned: today.earned + gained,
      paid: { ...today.paid, [deed]: times + 1 },
    },
    gained,
  }
}
