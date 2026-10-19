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
        const verb = isIn ? 'Sacar' : 'Meter'
        return (
          <li key={p.id} data-in={isIn || undefined}>
            <span className="room-roster-who">
              <span>{p.name}</span>
              <small>{isIn ? 'En la sala' : BREEDS[p.breedId].label}</small>
            </span>
            <button
              type="button"
              aria-label={`${verb} a ${p.name}`}
              onClick={() => onToggle(p, isIn)}
            >
              {verb}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
