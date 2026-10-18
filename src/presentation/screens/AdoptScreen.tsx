import { useId, useState, type FormEvent } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import { InvalidPuppyName } from '@/domain/puppy'
import UnsavedNotice from '../components/UnsavedNotice'

const BREED_IDS = Object.keys(BREEDS) as BreedId[]

/** A soft swatch of the breed's coat colours. */
const swatch = (id: BreedId) => {
  const colours = Object.values(BREEDS[id].palette)
  return `linear-gradient(135deg, ${colours.join(', ')})`
}

/** Choose a breed and a name, then adopt. */
export default function AdoptScreen({
  unsaved,
  onAdopt,
  onBack,
}: {
  unsaved: boolean
  /** Throws `InvalidPuppyName`. */
  onAdopt(input: { name: string; breedId: BreedId }): Promise<void>
  /** Back to the room, when there is someone in it. */
  onBack?: () => void
}) {
  const [breedId, setBreedId] = useState<BreedId>('dorado')
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameId = useId()
  const errorId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await onAdopt({ name, breedId })
    } catch (error) {
      if (!(error instanceof InvalidPuppyName)) throw error
      setInvalid(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(130%_85%_at_50%_28%,var(--color-ground),var(--color-ground-low))] px-4 py-8 text-ink">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="self-start rounded-full border border-line bg-glass px-4 py-2 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Volver a la sala
          </button>
        )}
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-3xl leading-tight font-semibold">Adopta un cachorro</h1>
          <p className="text-ink-soft">Elige una raza y ponle nombre.</p>
        </header>
        {unsaved && (
          <UnsavedNotice className="rounded-2xl border border-brand bg-glass px-4 py-3 text-sm font-semibold" />
        )}
        <form className="flex flex-col gap-6" noValidate onSubmit={(e) => void submit(e)}>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-bold tracking-wider text-ink-soft uppercase">
              Raza
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {BREED_IDS.map((id) => (
                <label
                  key={id}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-line bg-glass px-2 py-4 font-bold has-checked:border-ink has-checked:bg-ink has-checked:text-on-ink has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand"
                >
                  <input
                    type="radio"
                    name="breed"
                    value={id}
                    checked={breedId === id}
                    onChange={() => setBreedId(id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="size-12 rounded-full border border-line"
                    style={{ background: swatch(id) }}
                  />
                  {BREEDS[id].label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label
              htmlFor={nameId}
              className="text-sm font-bold tracking-wider text-ink-soft uppercase"
            >
              Nombre
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setInvalid(false)
              }}
              autoComplete="off"
              enterKeyHint="done"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              className="rounded-2xl border border-line bg-white/85 px-4 py-3 text-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand aria-invalid:border-brand"
            />
            {invalid && (
              <p id={errorId} role="alert" className="text-sm font-semibold text-error">
                Ponle un nombre de 1 a 20 letras.
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-ink px-6 py-3 text-lg font-bold text-on-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-45"
          >
            Adoptar
          </button>
        </form>
      </div>
    </main>
  )
}
