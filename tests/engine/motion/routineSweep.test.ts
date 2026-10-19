// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS, type BreedId } from '@/domain/breeds'
import { addMess, createCare, type Care } from '@/domain/care'
import { legRigs } from '@/engine/motion/ik'
import {
  createLegStates,
  createMotionState,
  goTo,
  stepLocomotion,
  type LegState,
  type MotionState,
} from '@/engine/motion/locomotion'
import { stepPoses } from '@/engine/motion/poses'
import {
  bedSlots,
  createRoutineState,
  giveWay,
  goWeigh,
  stepRoutine,
  staysPut,
  weighing,
  type RoutineState,
} from '@/engine/motion/routine'
import { anatomy } from '@/engine/puppy/anatomy'
import { bodyOf, bodyShape, createBody, type BodyShape } from '@/engine/room/bodies'
import { clampPlay, createCamera, fitCamera, PLAY, playHalf, playWorld } from '@/engine/room/camera'
import { keepOff, separate } from '@/engine/room/crowd'
import { computeSpots, inMud, inOval, type Spots } from '@/engine/room/furniture'
import { seeded } from '../seeded'

/**
 * Two puppies from random open-floor starts, the room run the way `tickPuppies` runs it: routine,
 * poses, steps, the scale kept clear, bodies kept apart, one making way. SWEEP_SEEDS raises the
 * seeds per aspect for a longer run than the suite's.
 */
const ASPECTS = [0.46, 0.65, 0.75, 0.85, 1, 1.23, 1.78, 2.1]
const SEEDS = Number(process.env.SWEEP_SEEDS ?? 5)
const DT = 1 / 60
const noon = new Date(2026, 9, 18, 12).getTime(),
  evening = new Date(2026, 9, 18, 20).getTime()

interface Pup {
  breed: BreedId
  r: RoutineState
  m: MotionState
  legs: LegState[]
  shape: BodyShape
  muzzle: number
  care: Care
  bowl: number
  fed: number
}

const kinds = (['dorado', 'shiba'] as const).map((breed) => {
  const A = anatomy(BREEDS[breed])
  return { breed, A, shape: bodyShape(A), muzzle: (A.tongue[2] - 0.12) * 0.7 }
})

function pup(i: number, x: number, z: number, hunger: number, bowl: number): Pup {
  const k = kinds[i]!
  const m = createMotionState()
  m.pos.set(x, 0, z)
  return {
    breed: k.breed,
    r: createRoutineState(),
    m,
    legs: createLegStates(legRigs(k.A), m),
    shape: k.shape,
    muzzle: k.muzzle,
    care: { ...createCare(BREEDS[k.breed], 0), energy: 0.8, hunger },
    bowl,
    fed: 0,
  }
}

/** Two spots of open floor half a metre apart, clear of the furniture and the puddle. */
function starts(cam: ReturnType<typeof fitCamera>, spots: Spots, random: () => number) {
  const out: { x: number; z: number }[] = []
  for (let n = 0; out.length < 2 && n < 10000; n++) {
    const d = PLAY.near + 0.1 + random() * (PLAY.far - PLAY.near - 0.2)
    const [x, z] = playWorld(cam, d, (random() * 2 - 1) * 0.9 * playHalf(cam, d))
    if ([...spots.beds, ...spots.bowls, spots.scale].some((s) => inOval(s, x, z, 0.2))) continue
    if (inMud(spots, x, z) > 0 || out.some((p) => Math.hypot(p.x - x, p.z - z) < 0.5)) continue
    out.push({ x, z })
  }
  return out
}

/** Runs the room until `done` or `secs` simulated seconds; the seconds it took, or null. */
function run(
  pups: Pup[],
  cam: ReturnType<typeof fitCamera>,
  spots: Spots,
  now: number,
  secs: number,
  done: () => boolean,
  each?: (t: number) => void,
): number | null {
  const clamp = (x: number, z: number) => clampPlay(cam, x, z)
  const clampTo = (p: { x: number; z: number }) => {
    ;[p.x, p.z] = clamp(p.x, p.z)
  }
  const random = seeded(7)
  for (let n = 0; n * DT < secs; n++) {
    pups.forEach((p, i) => {
      const ev = stepRoutine(
        p.r,
        p.m,
        {
          now: now + n * DT * 1000,
          care: p.care,
          spots,
          place: i,
          breed: BREEDS[p.breed],
          bowl: p.bowl,
          muzzle: p.muzzle,
          clamp,
          random,
        },
        DT,
      )
      p.care = ev.mess ? addMess(ev.care, { ...ev.mess, createdAt: 0 }) : ev.care
      p.bowl = ev.bowl
      if (ev.fed) p.fed++
      stepPoses(p.m, DT)
      stepLocomotion(p.m, p.legs, DT)
    })
    const ms = pups.map((p) => p.m)
    const owner = pups.find((p) => weighing(p.r))
    if (owner) keepOff(ms, owner.m, spots.scale.center.x, spots.scale.center.z, 0.5, clampTo)
    const bodies = pups.map((p) => bodyOf(p.m.pos, p.m.heading, p.m.pose, p.shape, createBody()))
    separate(
      ms,
      bodies,
      clampTo,
      pups.map((p) => staysPut(p.r)),
      DT,
    )
    giveWay(
      pups.map((p) => p.r),
      ms,
      bodies,
      pups.map((p) => p.r.routine === 'none' && p.m.pose === 'stand' && !p.r.held),
      clamp,
      spots,
    )
    each?.(n * DT)
    if (done()) return n * DT
  }
  return null
}

const rooms = ASPECTS.map((aspect) => {
  const cam = fitCamera(createCamera(), aspect)
  return { aspect, cam, spots: computeSpots(cam, 2) }
})
const cases = rooms.flatMap((room) =>
  Array.from({ length: SEEDS }, (_, i) => ({ ...room, seed: i + 1 })),
)
/** The failures of a sweep, kept for the summary at the end. */
const failed: string[] = []

describe('two puppies from random starts', () => {
  it.each(cases)('both eat at aspect $aspect, seed $seed', ({ aspect, cam, spots, seed }) => {
    const [a, b] = starts(cam, spots, seeded(seed * 97 + aspect * 100))
    const pups = [pup(0, a!.x, a!.z, 0.8, 1), pup(1, b!.x, b!.z, 0.8, 1)]
    const t = run(pups, cam, spots, noon, 30, () => pups.every((p) => p.fed > 0))
    if (t == null)
      failed.push(`eat ${aspect} ${seed} ${pups.map((p) => p.r.routine + ':' + p.fed)}`)
    expect(t).not.toBeNull()
  })

  it.each(cases.flatMap((c) => [0, 1].map((who) => ({ ...c, who }))))(
    '«Pesar» puts place $who on the scale while the other wanders at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed, who }) => {
      const random = seeded(seed * 89 + aspect * 100)
      const [a, b] = starts(cam, spots, random)
      const pups = [pup(0, a!.x, a!.z, 0.3, 0), pup(1, b!.x, b!.z, 0.3, 0)]
      const chosen = pups[who]!,
        other = pups[1 - who]!
      goWeigh(chosen.r, chosen.m)
      let next = 0
      const t = run(
        pups,
        cam,
        spots,
        noon,
        30,
        () => chosen.r.routine === 'onScale',
        (at) => {
          if (at < next || other.r.routine !== 'none') return
          next = at + 2.5
          const d = PLAY.near + random() * (PLAY.far - PLAY.near)
          const [x, z] = playWorld(cam, d, (random() * 2 - 1) * playHalf(cam, d))
          goTo(other.m, x, z, {
            happy: 0.5,
            energy: 0.5,
            gait: 'walk',
            clamp: (x, z) => clampPlay(cam, x, z),
          })
        },
      )
      if (t == null) failed.push(`weigh ${aspect} ${seed} ${who}`)
      expect(t).not.toBeNull()
    },
  )

  it.each(cases)(
    'at bedtime both curl up in their own beds at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed }) => {
      const [a, b] = starts(cam, spots, seeded(seed * 83 + aspect * 100))
      const pups = [pup(0, a!.x, a!.z, 0.3, 0), pup(1, b!.x, b!.z, 0.3, 0)]
      const slots = bedSlots(spots)
      const t = run(pups, cam, spots, evening, 60, () =>
        pups.every((p) => p.r.routine === 'sleeping'),
      )
      const off = pups.map((p, i) => Math.hypot(p.m.pos.x - slots[i]!.x, p.m.pos.z - slots[i]!.z))
      if (t == null || off.some((o) => o >= 0.1))
        failed.push(
          `sleep ${aspect} ${seed} t=${t} off=${off.map((o) => o.toFixed(2))} ${pups.map((p) => p.r.routine)}`,
        )
      expect(t).not.toBeNull()
      for (const o of off) expect(o).toBeLessThan(0.1)
    },
  )

  it('summary', () => {
    if (process.env.SWEEP_SEEDS)
      console.warn(`SWEEP ${SEEDS} seeds: ${failed.length} failed`, failed)
    expect(failed).toEqual([])
  })
})
