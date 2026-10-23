import { describe, expect, it } from 'vitest'
import { buy, choose, inUse, itemOf, spendOne, STANDARD_DECOR } from '../../src/domain/shop'
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
    expect(choose(wallet(0), 'plush')).toBeNull()
    const owned = buy(wallet(100), 'plush')!
    expect(choose(owned, 'plush')!.toy).toBe('plush')
    expect(choose(owned, 'ball')!.toy).toBe('ball')
  })

  it('reads a wallet saved before the shop as having bought nothing, and throwing the ball', () => {
    const { stock: _stock, owned: _owned, toy: _toy, decor: _decor, ...old } = createWallet(0)
    expect(withWalletDefaults(old)).toMatchObject({
      stock: {},
      owned: [],
      toy: 'ball',
      decor: STANDARD_DECOR,
    })
  })

  it('paints a slot of the room in a colour bought, the standard ones always to hand', () => {
    expect(inUse(wallet(0), 'bed-coral')).toBe(true)
    expect(choose(wallet(0), 'bed-sage')).toBeNull()
    expect(buy(wallet(100), 'bed-coral')).toBeNull()
    const sage = choose(buy(wallet(100), 'bed-sage')!, 'bed-sage')!
    expect(sage.decor).toEqual({ ...STANDARD_DECOR, bed: 'sage' })
    expect(inUse(sage, 'bed-sage')).toBe(true)
    expect(inUse(sage, 'bed-coral')).toBe(false)
    expect(choose(sage, 'bed-coral')!.decor.bed).toBe('coral')
  })

  it('sells a collar for the house, which a puppy wears rather than the house using it', () => {
    const bought = buy(wallet(30), 'collar-red')!
    expect(bought.owned).toEqual(['collar-red'])
    expect(choose(bought, 'collar-red')).toBeNull()
    expect(inUse(bought, 'collar-red')).toBe(false)
  })
})
