import { useState } from 'react'
import { AISLES, SHOP, type Aisle, type ItemId } from '@/domain/shop'
import type { Wallet } from '@/domain/wallet'

/** What can be bought, aisle by aisle, and how many of each there are already. */
export default function Shop({ wallet, onBuy }: { wallet: Wallet; onBuy(id: ItemId): void }) {
  const [aisle, setAisle] = useState<Aisle>(AISLES[0]!.id)
  return (
    <section className="room-shop" aria-label="Tienda">
      <h2 className="room-shop-title">Tienda</h2>
      {AISLES.length > 1 && (
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
      )}
      <ul className="room-shop-items">
        {SHOP.filter((item) => item.aisle === aisle).map((item) => {
          const short = item.price - wallet.coins
          const left = wallet.stock[item.id] ?? 0
          return (
            <li key={item.id}>
              <span className="room-shop-what">
                <span>{item.name}</span>
                <small>{item.blurb}</small>
                {left > 0 && <small className="room-shop-left">Tienes {left}</small>}
              </span>
              {short > 0 ? (
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
