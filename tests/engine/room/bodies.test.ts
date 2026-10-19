// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import { POSES } from '@/engine/motion/poses'
import { anatomy } from '@/engine/puppy/anatomy'
import { field } from '@/engine/puppy/sdf'
import { BALL_R } from '@/engine/room/ball'
import { bodyOf, bodyShape, createBody, shiftBody } from '@/engine/room/bodies'

const breeds = Object.values(BREEDS).map((b) => [b.id, b] as const)

describe('bodyShape', () => {
  it.each(breeds)('puts every sphere of a %s inside its own mesh', (_, breed) => {
    const A = anatomy(breed),
      { stand } = bodyShape(A)
    for (const s of [stand.head, stand.chest, stand.rump])
      expect(field(A.prims, 0, s.y, s.z)).toBeLessThan(0)
  })

  it.each(breeds)('leaves room for the ball in a %s mouth outside its head', (_, breed) => {
    const A = anatomy(breed),
      { head } = bodyShape(A).stand
    const mouthY = A.mouthInfo.mY - 0.01,
      mouthZ = A.mouthInfo.mEnd + 0.045
    expect(Math.hypot(mouthY - head.y, mouthZ - head.z)).toBeGreaterThan(head.r + BALL_R)
  })

  it('reaches from the snout to the rump: head ahead of chest ahead of rump', () => {
    const { stand } = bodyShape(anatomy(BREEDS.beagle))
    expect(stand.head.z).toBeGreaterThan(stand.chest.z)
    expect(stand.chest.z).toBeGreaterThan(stand.rump.z)
    expect(stand.head.z + stand.head.r - (stand.rump.z - stand.rump.r)).toBeGreaterThan(0.8)
  })

  it('sits on its rump, lies down whole and bows its head asleep', () => {
    const { stand, sit, lie, sleep } = bodyShape(anatomy(BREEDS.beagle))
    expect(stand.rump.y - sit.rump.y).toBeGreaterThan(stand.chest.y - sit.chest.y + 0.05)
    expect(sit.head.y).toBeGreaterThan(stand.head.y)
    for (const part of ['head', 'chest', 'rump'] as const)
      expect(lie[part].y - stand[part].y).toBeCloseTo(POSES.lie.y)
    expect(sleep.chest.y - stand.chest.y).toBeCloseTo(POSES.sleep.y)
    expect(stand.head.y - sleep.head.y).toBeGreaterThan(-POSES.sleep.y)
  })
})

describe('bodyOf', () => {
  const shape = bodyShape(anatomy(BREEDS.shiba))

  it('turns the spheres with the heading and writes them into the body it is given', () => {
    const out = createBody()
    expect(bodyOf({ x: 1, z: 2 }, Math.PI / 2, 'stand', shape, out)).toBe(out)
    expect(out.head.x).toBeCloseTo(1 + shape.stand.head.z)
    expect(out.head.z).toBeCloseTo(2)
    expect(out.rump.x).toBeCloseTo(1 + shape.stand.rump.z)
    expect(out.chest.y).toBe(shape.stand.chest.y)
    expect(out.chest.r).toBe(shape.stand.chest.r)
  })

  it('lies belly up as low as lying down', () => {
    const belly = bodyOf({ x: 0, z: 0 }, 0.3, 'belly', shape, createBody()),
      lie = bodyOf({ x: 0, z: 0 }, 0.3, 'lie', shape, createBody())
    expect(belly).toEqual(lie)
  })

  it('moves along the floor with shiftBody', () => {
    const b = bodyOf({ x: 0, z: 0 }, 0, 'lie', shape, createBody())
    shiftBody(b, 0.5, -0.25)
    expect(b).toEqual(bodyOf({ x: 0.5, z: -0.25 }, 0, 'lie', shape, createBody()))
  })
})
