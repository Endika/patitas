import { describe, expect, it } from 'vitest'
import { buy, chooseToy, itemOf, spendOne } from '../../src/domain/shop'
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

  it('keeps a toy once bought, and sells it only once', () => {
    const bought = buy(wallet(100), 'bone')!
    expect(bought.owned).toEqual(['bone'])
    expect(bought.coins).toBe(100 - itemOf('bone').price)
    expect(buy(bought, 'bone')).toBeNull()
  })

  it('throws the ball or a toy owned, never one not bought', () => {
    expect(chooseToy(wallet(0), 'plush')).toBeNull()
    const owned = buy(wallet(100), 'plush')!
    expect(chooseToy(owned, 'plush')!.toy).toBe('plush')
    expect(chooseToy(owned, 'ball')!.toy).toBe('ball')
  })

  it('reads a wallet saved before the shop as having bought nothing, and throwing the ball', () => {
    const { stock: _stock, owned: _owned, toy: _toy, ...old } = createWallet(0)
    expect(withWalletDefaults(old)).toMatchObject({ stock: {}, owned: [], toy: 'ball' })
  })
})
