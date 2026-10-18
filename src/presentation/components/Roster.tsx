import { BREEDS } from '@/domain/breeds'
import type { Puppy } from '@/domain/puppy'

/** Every adopted puppy, each with a button to bring it into the room or take it out. */
export default function Roster({
  puppies,
  inRoom,
  onToggle,
}: {
  puppies: Puppy[]
  inRoom: readonly string[]
  onToggle(puppy: Puppy, isIn: boolean): void
}) {
  return (
    <ul className="room-roster" aria-label="Tus cachorros">
      {puppies.map((p) => {
        const isIn = inRoom.includes(p.id)
        return (
          <li key={p.id} data-in={isIn || undefined}>
            <span>{p.name}</span>
            <small>{isIn ? 'En la sala' : BREEDS[p.breedId].label}</small>
            <button type="button" onClick={() => onToggle(p, isIn)}>
              {isIn ? 'Sacar' : 'Meter'} a {p.name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
