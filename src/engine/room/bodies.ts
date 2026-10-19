import type { Vec3 } from '@/engine/math'
import { SIT_DROP, SIT_PITCH } from '@/engine/motion/locomotion'
import { POSES, type PoseId } from '@/engine/motion/poses'
import type { Anatomy } from '@/engine/puppy/anatomy'
import { HEAD_LEVEL, NECK_LEVEL, SLEEP } from '@/engine/puppy/behaviour'

export interface Sphere {
  x: number
  y: number
  z: number
  r: number
}

/** A puppy's bulk as the ball and the other puppies meet it; the legs and tail are left out. */
export interface Body {
  head: Sphere
  chest: Sphere
  rump: Sphere
}

type Part = keyof Body
type BodyPoseId = 'stand' | 'sit' | 'lie' | 'sleep'

/** A sphere on the puppy's middle line: its height and how far it sits towards the snout. */
interface Local {
  y: number
  z: number
  r: number
}

/** A breed's three spheres in its own frame, for each pose. */
export type BodyShape = Record<BodyPoseId, Record<Part, Local>>

/** The skull's sphere reaches this far forward over the snout, keeping its back where it was. */
const SNOUT_REACH = 0.02

export function createBody(): Body {
  return {
    head: { x: 0, y: 0, z: 0, r: 0 },
    chest: { x: 0, y: 0, z: 0, r: 0 },
    rump: { x: 0, y: 0, z: 0, r: 0 },
  }
}

/** Turns (y, z) about (py, pz) by `a` round the puppy's x, as the bones turn. */
function pitch(l: Local, py: number, pz: number, a: number): Local {
  const c = Math.cos(a),
    s = Math.sin(a),
    dy = l.y - py,
    dz = l.z - pz
  return { y: py + dy * c - dz * s, z: pz + dy * s + dz * c, r: l.r }
}

const lower = (l: Local, dy: number): Local => ({ ...l, y: l.y + dy })

/**
 * The spheres from the breed's own mesh: the chest and pelvis spheres as they are, and the
 * skull's ellipsoid in its bounding sphere stretched a little over the snout. Each pose moves
 * them as the rig does: sitting pitches the spine back while the neck and head keep level,
 * lying lowers the whole body, and asleep the head also bows onto the front paws.
 */
export function bodyShape(A: Anatomy): BodyShape {
  const at = (name: string) => {
    const b = A.bones[A.bi[name] ?? -1]
    if (!b) throw new Error(`unknown bone "${name}"`)
    return b.pos
  }
  const sphereOn = (bone: string): Local => {
    const b = A.bi[bone]
    for (const p of A.prims)
      if (p.t === 0 && p.b === b && p.tag === 'body') return { y: p.cy, z: p.cz, r: p.r }
    throw new Error(`no body sphere on "${bone}"`)
  }
  let head: Local | null = null,
    volume = 0
  for (const p of A.prims)
    if (p.t === 1 && p.b === A.bi.head && p.tag === 'head' && p.rx * p.ry * p.rz > volume) {
      volume = p.rx * p.ry * p.rz
      const r = Math.max(p.rx, p.ry, p.rz) + SNOUT_REACH
      head = { y: p.cy, z: p.cz + SNOUT_REACH, r }
    }
  if (!head) throw new Error('no skull')
  const stand = { head, chest: sphereOn('chest'), rump: sphereOn('pelvis') }
  const spine = at('spine'),
    neck = at('neck'),
    skull = at('head')

  const tilt = -SIT_PITCH
  const sitHead = pitch(
    pitch(
      pitch(head, skull[1], skull[2], -tilt * HEAD_LEVEL),
      neck[1],
      neck[2],
      -tilt * NECK_LEVEL,
    ),
    spine[1],
    spine[2],
    tilt,
  )
  const sit = {
    head: lower(sitHead, -SIT_DROP),
    chest: lower(pitch(stand.chest, spine[1], spine[2], tilt), -SIT_DROP),
    rump: lower(pitch(stand.rump, spine[1], spine[2], tilt), -SIT_DROP),
  }
  const lying = (y: number, h: Local) => ({
    head: lower(h, y),
    chest: lower(stand.chest, y),
    rump: lower(stand.rump, y),
  })
  const bowed = pitch(
    pitch(head, skull[1], skull[2], SLEEP.head[0]),
    neck[1],
    neck[2],
    SLEEP.neck[0],
  )
  return { stand, sit, lie: lying(POSES.lie.y, head), sleep: lying(POSES.sleep.y, bowed) }
}

/**
 * Writes into `out` the spheres of a puppy standing at `pos` on the floor, facing `heading`.
 * Belly up or rolling in the mud it lies as low as lying down; the other poses, digging too,
 * count as standing.
 */
export function bodyOf(
  pos: Pick<Vec3, 'x' | 'z'>,
  heading: number,
  pose: PoseId,
  shape: BodyShape,
  out: Body,
): Body {
  const local =
    shape[
      pose === 'belly' || pose === 'roll'
        ? 'lie'
        : pose === 'sit' || pose === 'lie' || pose === 'sleep'
          ? pose
          : 'stand'
    ]
  const s = Math.sin(heading),
    c = Math.cos(heading)
  place(out.head, local.head, pos, s, c)
  place(out.chest, local.chest, pos, s, c)
  place(out.rump, local.rump, pos, s, c)
  return out
}

function place(o: Sphere, l: Local, pos: Pick<Vec3, 'x' | 'z'>, s: number, c: number) {
  o.x = pos.x + s * l.z
  o.y = l.y
  o.z = pos.z + c * l.z
  o.r = l.r
}

/** Moves every sphere of `b` by (dx, dz) along the floor. */
export function shiftBody(b: Body, dx: number, dz: number): void {
  for (let i = 0; i < SPHERES; i++) {
    const o = sphereAt(b, i)
    o.x += dx
    o.z += dz
  }
}

export const SPHERES = 3

/** The spheres of `b` by index, for loops that build no arrays. */
export const sphereAt = (b: Body, i: number): Sphere =>
  i === 0 ? b.head : i === 1 ? b.chest : b.rump
