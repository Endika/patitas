import { describe, expect, it } from 'vitest'
import { buy, itemOf, spendOne } from '../../src/domain/shop'
import { createWallet, withWalletDefaults } from '../../src/domain/wallet'

const wallet = (coins: number) => ({ ...createWallet(0), coins })

describe('shop', () => {
  it('sells for its price, into the stock', () => {
    const price = itemOf('premium').price
    const bought = buy(wallet(price + 3), 'premium')!
    expect(bought.coins).toBe(3)
    expect(bought.stock.premium).toBe(1)
    expect(buy(bought, 'premium')).toBeNull()
  })

  it('will not sell for fewer coins than the price', () => {
    expect(buy(wallet(itemOf('energy').price - 1), 'energy')).toBeNull()
  })

  it('uses one up, and none when there is none left', () => {
    const one = buy(wallet(100), 'light')!
    const used = spendOne(one, 'light')!
    expect(used.stock.light).toBe(0)
    expect(spendOne(used, 'light')).toBeNull()
  })

  it('reads a wallet saved before the shop as having bought nothing', () => {
    const { stock: _stock, ...old } = createWallet(0)
    expect(withWalletDefaults(old).stock).toEqual({})
  })
})
