import { useState } from 'react'
import { AISLES, isKeepsake, SHOP, type Aisle, type ItemId, type ToyId } from '@/domain/shop'
import type { Wallet } from '@/domain/wallet'

const BALL = { name: 'Pelota', blurb: 'La de siempre: bota y rueda.' }

/**
 * What can be bought, aisle by aisle, and how many of each there are already; a toy owned, the
 * ball among them, can be chosen to throw.
 */
export default function Shop({
  wallet,
  onBuy,
  onToy,
}: {
  wallet: Wallet
  onBuy(id: ItemId): void
  onToy(toy: ToyId): void
}) {
  const [aisle, setAisle] = useState<Aisle>(AISLES[0]!.id)
  const toyButton = (toy: ToyId, name: string) =>
    wallet.toy === toy ? (
      <button type="button" aria-pressed="true" aria-label={`${name}, en uso`}>
        En uso
      </button>
    ) : (
      <button
        type="button"
        aria-pressed="false"
        aria-label={`Usar ${name}`}
        onClick={() => onToy(toy)}
      >
        Usar
      </button>
    )
  return (
    <section className="room-shop" aria-label="Tienda">
      <h2 className="room-shop-title">Tienda</h2>
      <div className="room-shop-aisles" role="tablist" aria-label="Secciones">
        {AISLES.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={a.id === aisle}
            onClick={() => setAisle(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>
      <ul className="room-shop-items">
        {aisle === 'toy' && (
          <li>
            <span className="room-shop-what">
              <span>{BALL.name}</span>
              <small>{BALL.blurb}</small>
            </span>
            {toyButton('ball', BALL.name)}
          </li>
        )}
        {SHOP.filter((item) => item.aisle === aisle).map((item) => {
          const short = item.price - wallet.coins
          const owned = isKeepsake(item.id) && wallet.owned.includes(item.id)
          const left = isKeepsake(item.id) ? 0 : (wallet.stock[item.id] ?? 0)
          return (
            <li key={item.id}>
              <span className="room-shop-what">
                <span>{item.name}</span>
                <small>{item.blurb}</small>
                {left > 0 && <small className="room-shop-left">Tienes {left}</small>}
              </span>
              {owned ? (
                toyButton(item.id as ToyId, item.name)
              ) : short > 0 ? (
                <button type="button" disabled aria-label={`${item.name}: faltan ${short} monedas`}>
                  Faltan {short}
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`Comprar ${item.name} por ${item.price} monedas`}
                  onClick={() => onBuy(item.id)}
                >
                  <span className="room-coin" aria-hidden="true" />
                  {item.price}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
