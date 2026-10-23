import { describe, expect, it } from 'vitest'
import {
  createWallet,
  DAILY_CAP,
  earn,
  PAY,
  START_COINS,
  type Deed,
  type Wallet,
} from '../../src/domain/wallet'

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime()

const times = (wallet: Wallet, deed: Deed, n: number, now: number) => {
  let w = wallet
  for (let i = 0; i < n; i++) w = earn(w, deed, now).wallet
  return w
}

describe('wallet', () => {
  it('starts with a little to spend', () => {
    expect(createWallet(at(24, 10)).coins).toBe(START_COINS)
  })

  it('pays each deed its coins, as many times a day as it may', () => {
    const start = createWallet(at(24, 10))
    const first = earn(start, 'bath', at(24, 11))
    expect(first.gained).toBe(PAY.bath.coins)
    expect(first.wallet.coins).toBe(START_COINS + PAY.bath.coins)

    const done = times(start, 'bath', PAY.bath.times, at(24, 11))
    const again = earn(done, 'bath', at(24, 12))
    expect(again.gained).toBe(0)
    expect(again.wallet.coins).toBe(START_COINS + PAY.bath.coins * PAY.bath.times)
    // Another deed still pays
    expect(earn(done, 'meal', at(24, 12)).gained).toBe(PAY.meal.coins)
  })

  it('stops paying at the day cap, the last pay cut to what is left', () => {
    let w = createWallet(at(24, 8))
    const all = Object.keys(PAY) as Deed[]
    for (const deed of all) w = times(w, deed, PAY[deed].times, at(24, 9))
    expect(w.earned).toBe(DAILY_CAP)
    expect(w.coins).toBe(START_COINS + DAILY_CAP)
  })

  it('pays afresh once the day turns at midnight', () => {
    const late = times(createWallet(at(24, 8)), 'trick', PAY.trick.times, at(24, 23))
    expect(earn(late, 'trick', at(24, 23)).gained).toBe(0)
    const next = earn(late, 'trick', at(25, 0))
    expect(next.gained).toBe(PAY.trick.coins)
    expect(next.wallet.earned).toBe(PAY.trick.coins)
    expect(next.wallet.coins).toBe(late.coins + PAY.trick.coins)
  })
})
