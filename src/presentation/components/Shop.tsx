import { useState } from 'react'
import {
  AISLES,
  inUse,
  isKeepsake,
  owns,
  SHOP,
  type Aisle,
  type ItemId,
  type Keepsake,
} from '@/domain/shop'
import type { Wallet } from '@/domain/wallet'

/**
 * What can be bought, aisle by aisle, and how many of each there are already; a keepsake the
 * house has, the toys and the colours for the room, can be chosen to use.
 */
export default function Shop({
  wallet,
  onBuy,
  onUse,
}: {
  wallet: Wallet
  onBuy(id: ItemId): void
  onUse(id: Keepsake): void
}) {
  const [aisle, setAisle] = useState<Aisle>(AISLES[0]!.id)
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
        {SHOP.filter((item) => item.aisle === aisle).map((item) => {
          const short = item.price - wallet.coins
          const keep = isKeepsake(item.id) ? item.id : null
          const left = keep ? 0 : (wallet.stock[item.id as Exclude<ItemId, Keepsake>] ?? 0)
          let action
          if (keep && inUse(wallet, keep))
            action = (
              <button type="button" aria-pressed="true" aria-label={`${item.name}, en uso`}>
                En uso
              </button>
            )
          else if (keep && owns(wallet, keep))
            action = (
              <button
                type="button"
                aria-pressed="false"
                aria-label={`Usar ${item.name}`}
                onClick={() => onUse(keep)}
              >
                Usar
              </button>
            )
          else if (short > 0)
            action = (
              <button type="button" disabled aria-label={`${item.name}: faltan ${short} monedas`}>
                Faltan {short}
              </button>
            )
          else
            action = (
              <button
                type="button"
                aria-label={`Comprar ${item.name} por ${item.price} monedas`}
                onClick={() => onBuy(item.id)}
              >
                <span className="room-coin" aria-hidden="true" />
                {item.price}
              </button>
            )
          return (
            <li key={item.id}>
              <span className="room-shop-what">
                <span>{item.name}</span>
                <small>{item.blurb}</small>
                {left > 0 && <small className="room-shop-left">Tienes {left}</small>}
              </span>
              {action}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
