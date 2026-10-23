// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest'
import { BREEDS, type BreedId, type Persona } from '@/domain/breeds'
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
  createPeer,
  createRoutineState,
  giveWay,
  goToMud,
  goWeigh,
  holdStill,
  MUD_EVERY,
  letGo,
  seePeer,
  stepRoutine,
  staysPut,
  wallowing,
  weighing,
  type RoutineState,
} from '@/engine/motion/routine'
import { anatomy } from '@/engine/puppy/anatomy'
import { bodyOf, bodyShape, createBody, type BodyShape } from '@/engine/room/bodies'
import { clampPlay, createCamera, fitCamera, PLAY, playHalf, playWorld } from '@/engine/room/camera'
import { separate } from '@/engine/room/crowd'
import {
  computeSpots,
  furnitureObstacles,
  inMud,
  inOval,
  type Spots,
} from '@/engine/room/furniture'
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
  persona: Persona
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
    persona: BREEDS[k.breed].defaultPersona,
  }
}

/** Two spots of open floor `apart` (half a metre) apart, clear of the furniture and the puddle. */
function starts(
  cam: ReturnType<typeof fitCamera>,
  spots: Spots,
  random: () => number,
  apart = 0.5,
) {
  const out: { x: number; z: number }[] = []
  for (let n = 0; out.length < 2 && n < 10000; n++) {
    const d = PLAY.near + 0.1 + random() * (PLAY.far - PLAY.near - 0.2)
    const [x, z] = playWorld(cam, d, (random() * 2 - 1) * 0.9 * playHalf(cam, d))
    if ([...spots.beds, ...spots.bowls, spots.scale].some((s) => inOval(s, x, z, 0.2))) continue
    if (inMud(spots, x, z) > 0 || out.some((p) => Math.hypot(p.x - x, p.z - z) < apart)) continue
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
  random: () => number = seeded(7),
): number | null {
  const clamp = (x: number, z: number) => clampPlay(cam, x, z)
  const clampTo = (p: { x: number; z: number }) => {
    ;[p.x, p.z] = clamp(p.x, p.z)
  }
  const peers = pups.map((p) => createPeer(p.persona))
  nearest = Infinity
  for (let n = 0; n * DT < secs; n++) {
    pups.forEach((p, i) => seePeer(peers[i]!, p.r, p.m, p.persona, false))
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
          energy: p.persona.energy,
          cuddly: p.persona.cuddly,
          social: p.persona.social,
          curious: p.persona.curious,
          peer: peers[1 - i],
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
    const bodies = pups.map((p) => bodyOf(p.m.pos, p.m.heading, p.m.pose, p.shape, createBody()))
    separate(
      ms,
      bodies,
      clampTo,
      pups.map((p) => staysPut(p.r)),
      DT,
      owner ? { owner: owner.m, x: spots.scale.center.x, z: spots.scale.center.z, r: 0.5 } : null,
    )
    giveWay(
      pups.map((p) => p.r),
      ms,
      bodies,
      pups.map((p) => p.r.routine === 'none' && p.m.pose === 'stand' && !p.r.held),
      clamp,
      spots,
    )
    nearest = Math.min(
      nearest,
      Math.hypot(ms[0]!.pos.x - ms[1]!.pos.x, ms[0]!.pos.z - ms[1]!.pos.z),
    )
    each?.(n * DT)
    if (done()) {
      lastResorts += pups.reduce((k, p) => k + p.r.backedOff, 0)
      return n * DT
    }
  }
  lastResorts += pups.reduce((k, p) => k + p.r.backedOff, 0)
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
/**
 * The closest two centres came in the last run and in all, and the times one backed off for the
 * other (the last resort). Two standing bodies that only touch, a dorado's and a shiba's turned
 * head to tail and offset, stand 0.334 apart centre to centre: nearer than TOUCHING, one is in the
 * other.
 */
let nearest = Infinity,
  closest = Infinity,
  lastResorts = 0
/** Each run keeps the bodies out of each other. */
const keptApart = () => {
  closest = Math.min(closest, nearest)
  expect(nearest).toBeGreaterThanOrEqual(TOUCHING)
}
const TOUCHING = 0.33

describe('two puppies from random starts', () => {
  it.each(cases)('both eat at aspect $aspect, seed $seed', ({ aspect, cam, spots, seed }) => {
    const [a, b] = starts(cam, spots, seeded(seed * 97 + aspect * 100))
    const pups = [pup(0, a!.x, a!.z, 0.8, 1), pup(1, b!.x, b!.z, 0.8, 1)]
    const t = run(pups, cam, spots, noon, 30, () => pups.every((p) => p.fed > 0))
    if (t == null)
      failed.push(`eat ${aspect} ${seed} ${pups.map((p) => p.r.routine + ':' + p.fed)}`)
    keptApart()
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
      // The other is sent somewhere new every 2.5 s, now and then into the way again: with no
      // squeezing past, the weigher may have to back off and walk round it more than once
      const t = run(
        pups,
        cam,
        spots,
        noon,
        40,
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
      keptApart()
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
      keptApart()
      expect(t).not.toBeNull()
      for (const o of off) expect(o).toBeLessThan(0.1)
    },
  )

  it.each(cases.flatMap((c) => [0, 1].map((who) => ({ ...c, who }))))(
    'place $who rolls or digs in the mud while the other eats at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed, who }) => {
      const [a, b] = starts(cam, spots, seeded(seed * 79 + aspect * 100))
      const muddy = who === 0
      const pups = [
        pup(0, a!.x, a!.z, muddy ? 0.3 : 0.8, muddy ? 0 : 1),
        pup(1, b!.x, b!.z, muddy ? 0.8 : 0.3, muddy ? 1 : 0),
      ]
      const mud = pups[who]!,
        other = pups[1 - who]!
      goToMud(mud.r, mud.m, spots, (x, z) => clampPlay(cam, x, z))
      let wallowed = false,
        back = false
      const t = run(
        pups,
        cam,
        spots,
        noon,
        40,
        () => back && other.fed > 0,
        () => {
          wallowed ||= !!wallowing(mud.r, mud.m)
          back ||= wallowed && mud.r.routine === 'none'
        },
      )
      if (t == null)
        failed.push(
          `mud ${aspect} ${seed} ${who} wallowed=${wallowed} back=${back} ${mud.r.routine} ${other.r.routine}:${other.fed}`,
        )
      keptApart()
      expect(t).not.toBeNull()
    },
  )

  it.each(cases)(
    'left alone by day the dorado naps in its bed and the shiba on the floor at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed }) => {
      const [a, b] = starts(cam, spots, seeded(seed * 73 + aspect * 100))
      const pups = [pup(0, a!.x, a!.z, 0.3, 0), pup(1, b!.x, b!.z, 0.3, 0)]
      // Most of the way to a nap already, so the run is short
      for (const p of pups) p.r.alone = 100
      const t = run(pups, cam, spots, noon, 60, () => pups.every((p) => p.r.routine === 'sleeping'))
      const naps = pups.map((p) => p.r.nap)
      if (t == null || naps[0] !== 'bed' || naps[1] !== 'floor')
        failed.push(`nap ${aspect} ${seed} t=${t} ${naps} ${pups.map((p) => p.r.routine)}`)
      keptApart()
      expect(t).not.toBeNull()
      expect(naps).toEqual(['bed', 'floor'])
    },
  )

  it.each(cases)(
    'the dorado greets the shiba back from its bath at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed }) => {
      const [a, b] = starts(cam, spots, seeded(seed * 71 + aspect * 100))
      const pups = [pup(0, a!.x, a!.z, 0.3, 0), pup(1, b!.x, b!.z, 0.3, 0)]
      const [dorado, shiba] = pups as [Pup, Pup]
      dorado.r.greetAgo = shiba.r.greetAgo = 60
      holdStill(shiba.r, shiba.m, 'bathing')
      let greeted = false
      const t = run(
        pups,
        cam,
        spots,
        noon,
        20,
        () => greeted && dorado.r.routine === 'none',
        (at) => {
          if (at > 0.5 && shiba.r.held) letGo(shiba.r)
          greeted ||= dorado.r.routine === 'greeting' && dorado.r.sniffT >= 0
        },
        // Every die rolls low: the greeting is never left to chance
        () => 0.01,
      )
      if (t == null) failed.push(`greet ${aspect} ${seed} ${pups.map((p) => p.r.routine)}`)
      keptApart()
      expect(t).not.toBeNull()
    },
  )

  it.each(cases)(
    'the two play in place and stay apart at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed }) => {
      const [a, b] = starts(cam, spots, seeded(seed * 67 + aspect * 100), 1)
      // No two open spots a body apart in this room: no game to start
      if (!a || !b) return
      const pups = [pup(0, a!.x, a!.z, 0.3, 0), pup(1, b!.x, b!.z, 0.3, 0)]
      for (const p of pups) {
        p.r.playAgo = 90
        p.r.alone = 15
      }
      const games = new Set(['sparring'])
      const pieces = furnitureObstacles(spots)
      let played = false,
        near = Infinity,
        trod = 0
      const t = run(
        pups,
        cam,
        spots,
        noon,
        20,
        () => played && pups.every((p) => p.r.routine === 'none'),
        () => {
          played ||= pups.every((p) => games.has(p.r.routine))
          if (!pups.every((p) => games.has(p.r.routine) && p.r.playT > 1)) return
          const [x, y] = pups as [Pup, Pup]
          near = Math.min(near, Math.hypot(x.m.pos.x - y.m.pos.x, x.m.pos.z - y.m.pos.z))
          for (const p of pups)
            if (
              inMud(spots, p.m.pos.x, p.m.pos.z) > 0 ||
              pieces.some((c) => Math.hypot(p.m.pos.x - c.x, p.m.pos.z - c.z) < c.r)
            )
              trod++
        },
        // Every die rolls lowest: they ask at once and always join
        () => 0,
      )
      if (t == null || near < 0.85 || trod > 0)
        failed.push(`play ${aspect} ${seed} t=${t} near=${near.toFixed(2)} trod=${trod}`)
      keptApart()
      expect(t).not.toBeNull()
      expect(near).toBeGreaterThan(0.85)
      expect(trod).toBe(0)
    },
  )

  it.each(cases)(
    'one follows the other to the mud, and only then rolls, at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed }) => {
      const [a, b] = starts(cam, spots, seeded(seed * 61 + aspect * 100))
      const pups = [pup(0, a!.x, a!.z, 0.3, 0), pup(1, b!.x, b!.z, 0.3, 0)]
      // The one nearer the puddle goes, the other may follow
      const mud = spots.mud.center
      const near = (p: Pup) => Math.hypot(p.m.pos.x - mud.x, p.m.pos.z - mud.z)
      const [dorado, shiba] = (near(pups[0]!) < near(pups[1]!) ? pups : [...pups].reverse()) as [
        Pup,
        Pup,
      ]
      shiba.r.mudAgo = MUD_EVERY
      goToMud(dorado.r, dorado.m, spots, (x, z) => clampPlay(cam, x, z))
      let followed = false,
        left = false,
        both = 0
      const t = run(
        pups,
        cam,
        spots,
        noon,
        75,
        // Done following, and out of the mud again if it went for a roll (it waits while the other
        // stands in the puddle)
        () => left && pups.every((p) => p.r.routine === 'none') && !wallowing(shiba.r, shiba.m),
        () => {
          followed ||= shiba.r.routine === 'following'
          left ||= followed && shiba.r.routine !== 'following'
          if (pups.every((p) => inMud(spots, p.m.pos.x, p.m.pos.z) > 0)) both++
        },
        // Every die rolls lowest: it always follows
        () => 0,
      )
      if (t == null || both > 0)
        failed.push(`follow ${aspect} ${seed} both=${both} ${pups.map((p) => p.r.routine)}`)
      keptApart()
      expect(t).not.toBeNull()
      expect(both).toBe(0)
    },
  )

  it.each(cases)(
    'left alone by day, two nap on the floor and never lie on each other at aspect $aspect, seed $seed',
    ({ aspect, cam, spots, seed }) => {
      const [a, b] = starts(cam, spots, seeded(seed * 59 + aspect * 100))
      const pups = [pup(0, a!.x, a!.z, 0.3, 0), pup(1, b!.x, b!.z, 0.3, 0)]
      // Neither cuddly enough for its bed
      for (const p of pups) p.persona = { ...p.persona, cuddly: 0.2 }
      pups[0]!.r.alone = 200
      pups[1]!.r.alone = 100
      // Lying down, never within a body length of the other lying there, less the arrival slack
      let lay = Infinity
      const t = run(
        pups,
        cam,
        spots,
        noon,
        30,
        // Long enough for both to nap, or the second to stay up for want of room
        () => false,
        () => {
          const [x, y] = pups as [Pup, Pup]
          // From the other's middle or its head, the nearer
          const hx = x.m.pos.x + Math.sin(x.m.heading) * 0.41,
            hz = x.m.pos.z + Math.cos(x.m.heading) * 0.41
          if (y.r.routine === 'settling' || y.r.routine === 'sleeping')
            lay = Math.min(
              lay,
              Math.hypot(x.m.pos.x - y.m.pos.x, x.m.pos.z - y.m.pos.z),
              Math.hypot(hx - y.m.pos.x, hz - y.m.pos.z),
            )
        },
      )
      if (lay < 0.6) failed.push(`naps ${aspect} ${seed} lay=${lay.toFixed(2)}`)
      keptApart()
      expect(t).toBeNull()
      expect([pups[0]!.r.routine, pups[0]!.r.nap]).toEqual(['sleeping', 'floor'])
      expect(lay).toBeGreaterThan(0.6)
    },
  )

  // Each case asserts its own run; a longer sweep prints what they came to
  afterAll(() => {
    if (process.env.SWEEP_SEEDS)
      console.warn(
        `SWEEP ${SEEDS} seeds: ${failed.length} failed, closest ${closest.toFixed(3)}, ${lastResorts} last resorts`,
        failed,
      )
  })
})
