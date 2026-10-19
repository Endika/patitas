import { useId, useState, type FormEvent } from 'react'
import { BREEDS, type BreedId } from '@/domain/breeds'
import { InvalidPuppyName } from '@/domain/puppy'
import AdoptPreview, { type CreatePreview } from '../components/AdoptPreview'
import UnsavedNotice from '../components/UnsavedNotice'
import { swatch } from '../swatch'

const BREED_IDS = Object.keys(BREEDS) as BreedId[]

/** Choose a breed and a name, then adopt. */
export default function AdoptScreen({
  unsaved,
  onAdopt,
  onBack,
  createPreview,
  exitAsked = false,
}: {
  unsaved: boolean
  /** Throws `InvalidPuppyName`. */
  onAdopt(input: { name: string; breedId: BreedId }): Promise<void>
  /** Back to the room, when there is someone in it. */
  onBack?: () => void
  createPreview?: CreatePreview
  /** A back with nothing to go back to: one more leaves. */
  exitAsked?: boolean
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
    <main className="flex min-h-dvh flex-col bg-[radial-gradient(130%_85%_at_50%_28%,var(--color-ground),var(--color-ground-low))] pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] text-ink">
      {/* On a phone on its side, the puppy stays on the left while the form scrolls on the right */}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 phone-landscape:grid phone-landscape:max-w-3xl phone-landscape:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] phone-landscape:grid-rows-[auto_1fr] phone-landscape:gap-x-6">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="min-h-11 self-start rounded-full border border-line bg-glass px-4 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand phone-landscape:col-start-2"
          >
            Volver a la sala
          </button>
        )}
        <AdoptPreview breedId={breedId} createPreview={createPreview} />
        <div className="flex flex-col gap-4 phone-landscape:col-start-2">
          <header className="flex flex-col gap-1">
            <h1 className="font-display text-3xl leading-tight font-semibold phone-landscape:text-2xl">
              Adopta un cachorro
            </h1>
            <p className="text-ink-soft">Elige una raza y ponle nombre.</p>
          </header>
          {exitAsked && (
            <p
              role="status"
              className="rounded-2xl border border-brand bg-glass px-4 py-3 text-sm font-semibold"
            >
              Pulsa atrás otra vez para salir
            </p>
          )}
          {unsaved && (
            <UnsavedNotice className="rounded-2xl border border-brand bg-glass px-4 py-3 text-sm font-semibold" />
          )}
          <form
            className="flex flex-col gap-5 phone-landscape:gap-4"
            noValidate
            onSubmit={(e) => void submit(e)}
          >
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-sm font-bold tracking-wider text-ink-soft uppercase">
                Raza
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {BREED_IDS.map((id) => (
                  <label
                    key={id}
                    className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-line bg-glass px-2 py-3 font-bold phone-landscape:flex-row phone-landscape:justify-center phone-landscape:py-2 has-checked:border-ink has-checked:bg-ink has-checked:text-on-ink has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand"
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
                      className="size-12 rounded-full border border-line phone-landscape:size-8"
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
      </div>
    </main>
  )
}
