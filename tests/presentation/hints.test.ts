import { hintText, HINTS } from '@/presentation/hints'

describe('hintText', () => {
  it('names the puppy that is asleep', () => {
    expect(hintText('sleep', 'Kuma')).toBe('Kuma está durmiendo. Tócalo para despertarlo.')
  })

  it('reads the other hints as they are', () => {
    expect(hintText('chase', 'Kuma')).toBe(HINTS.chase)
  })
})
