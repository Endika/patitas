// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BreedId } from '@/domain/breeds'
import { createBreedSwitch } from '@/presentation/breedSwitch'

/** A switch over loads the test settles by hand, recording what it is told. */
function harness(ready: Partial<Record<BreedId, string>> = {}) {
  const log: string[] = []
  const pending = new Map<BreedId, { resolve(g: string): void; reject(e: Error): void }[]>()
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  const sw = createBreedSwitch<string>({
    load: (id) =>
      new Promise<string>((resolve, reject) => {
        pending.set(id, [...(pending.get(id) ?? []), { resolve, reject }])
      }),
    peek: (id) => ready[id],
    mount: (id, g) => void log.push(`mount:${id}:${g}`),
    unmount: () => void log.push('unmount'),
    status: (s) => void log.push(s.failed ? 'failed' : s.loading ? 'loading' : 'ready'),
  })
  return {
    sw,
    log,
    async resolve(id: BreedId) {
      for (const p of pending.get(id) ?? []) p.resolve(`${id}-mesh`)
      pending.delete(id)
      await settle()
    },
    async reject(id: BreedId) {
      for (const p of pending.get(id) ?? []) p.reject(new Error('boom'))
      pending.delete(id)
      await settle()
    },
  }
}

describe('createBreedSwitch', () => {
  it('mounts only the last breed asked for, whatever order the meshes arrive in', async () => {
    const h = harness()
    h.sw.show('dorado')
    h.sw.show('shiba')
    h.sw.show('beagle')
    await h.resolve('beagle')
    await h.resolve('dorado')
    await h.resolve('shiba')

    expect(h.log.filter((l) => l.startsWith('mount'))).toEqual(['mount:beagle:beagle-mesh'])
    expect(h.log.at(-1)).toBe('ready')
  })

  it('replaces the puppy on show and is loading until the new mesh is ready', async () => {
    const h = harness()
    h.sw.show('dorado')
    await h.resolve('dorado')
    h.sw.show('shiba')

    expect(h.log).toEqual(['loading', 'mount:dorado:dorado-mesh', 'ready', 'unmount', 'loading'])
    await h.resolve('shiba')
    expect(h.log.slice(-2)).toEqual(['mount:shiba:shiba-mesh', 'ready'])
  })

  it('mounts a mesh that is already built at once', () => {
    const h = harness({ shiba: 'cached' })
    h.sw.show('shiba')

    expect(h.log).toEqual(['mount:shiba:cached', 'ready'])
  })

  it('ignores asking again for the breed it is showing', async () => {
    const h = harness()
    h.sw.show('dorado')
    await h.resolve('dorado')
    h.sw.show('dorado')

    expect(h.log).toEqual(['loading', 'mount:dorado:dorado-mesh', 'ready'])
  })

  it('reports a failure only for the wanted breed and retries when asked again', async () => {
    const h = harness()
    h.sw.show('dorado')
    h.sw.show('shiba')
    await h.reject('dorado')
    expect(h.log).not.toContain('failed')

    await h.reject('shiba')
    expect(h.log.at(-1)).toBe('failed')

    h.sw.show('shiba')
    await h.resolve('shiba')
    expect(h.log.slice(-3)).toEqual(['loading', 'mount:shiba:shiba-mesh', 'ready'])
  })

  it('mounts and reports nothing once stopped', async () => {
    const h = harness()
    h.sw.show('dorado')
    h.sw.stop()
    await h.resolve('dorado')
    h.sw.show('beagle')

    expect(h.log).toEqual(['loading'])
  })
})
