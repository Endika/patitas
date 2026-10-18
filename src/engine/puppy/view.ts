import * as THREE from 'three'
import { BREEDS, type Breed } from '@/domain/breeds'
import { createCare, type Care } from '@/domain/care'
import type { Puppy } from '@/domain/puppy'
import { clamp, damp, type Vec3 } from '@/engine/math'
import {
  createFetchState,
  stepFetch,
  type FetchEvents,
  type FetchState,
} from '@/engine/motion/fetch'
import { legRigs, solveTwoBone } from '@/engine/motion/ik'
import {
  createLegStates,
  createMotionState,
  goTo,
  stepLocomotion,
  type BodyPose,
  type LegState,
  type MotionState,
} from '@/engine/motion/locomotion'
import { setPose, stepPoses, type PoseId } from '@/engine/motion/poses'
import {
  createRoutineState,
  keepsEating,
  stepRoutine,
  touch,
  type RoutineState,
} from '@/engine/motion/routine'
import type { BallState } from '@/engine/room/ball'
import { cameraPosition, clampPlay, playAxes } from '@/engine/room/camera'
import { claimBall, separate } from '@/engine/room/crowd'
import { showBowls } from '@/engine/room/furniture'
import { raySphere, type PuppyHit } from '@/engine/room/input'
import type { Quality, RoomScene, SceneView } from '@/engine/room/scene'
import type { Anatomy, Tuple3, ZoneId } from './anatomy'
import {
  behaviourRig,
  createBehaviourState,
  LID_OPEN,
  LOW_LID,
  stepBehaviour,
  yawn,
  type BehaviourPose,
  type BehaviourRig,
  type BehaviourState,
} from './behaviour'
import { RIM } from './coat'
import { eyeTexture, lidGeometry, makeTongue, noseGeometry, shapeTongue } from './face'
import type { PuppyGeometry } from './geometry'
import {
  eyeMaterial,
  furMaterial,
  furUniforms,
  glintMaterial,
  lidMaterial,
  noseMaterial,
  setFurHeight,
  tongueMaterial,
} from './materials'

export type { PuppyGeometry } from './geometry'

export interface EyeRig {
  pivot: THREE.Object3D
  ball: THREE.Mesh
  lid: THREE.Mesh
  low: THREE.Mesh
}

export interface ZoneRig {
  zone: ZoneId
  bone: THREE.Bone
  /** Zone centre in the bone's frame. */
  off: THREE.Vector3
  r: number
}

export interface LegBones {
  up: THREE.Bone
  lo: THREE.Bone
  end: THREE.Bone
}

export interface PuppyView extends BehaviourRig, SceneView {
  puppy: Puppy
  breed: Breed
  anatomy: Anatomy
  group: THREE.Group
  bones: Record<string, THREE.Bone>
  /** Bone rest positions relative to their parents. */
  rest: Record<string, THREE.Vector3>
  eyes: EyeRig[]
  tongue: THREE.Mesh
  zones: ZoneRig[]
  /** In the order of `legs`: [LF, RF, LH, RH]. */
  legBones: LegBones[]
  legs: LegState[]
  motion: MotionState
  fetch: FetchState
  behaviour: BehaviourState
  routine: RoutineState
  /** Kept in memory while the room is open. */
  care: Care
  /**
   * How full its own bowl is, 0 to 1: kept with the puppy rather than in the furniture, so a
   * bowl laid out anew shows it again.
   */
  bowl: number
  /** Its place in the room's order: which bed and bowl are its. */
  place: number
  /** Seconds to the next «z» while asleep. */
  snoreT: number
  /** Where a held ball sits, in the jaw's frame. */
  mouth: THREE.Vector3
  /** How far in front of the body the mouth picks up the ball. */
  reach: number
  /** Shows `q.shells` fur layers. */
  setQuality(q: Quality): void
  dispose(): void
}

const LEG_BONES: [string, string, string][] = [
  ['shL', 'elL', 'wrL'],
  ['shR', 'elR', 'wrR'],
  ['hipL', 'kneeL', 'hockL'],
  ['hipR', 'kneeR', 'hockR'],
]

/** Upper, middle and paw rotations of the right hind leg while it scratches. */
const SCRATCH: Tuple3 = [-0.85, 0.55, -0.35]

const GLINTS: [Tuple3, number, number][] = [
  [[0.36, 0.4, 0.84], 0.12, 0.9],
  [[-0.26, -0.28, 0.92], 0.05, 0.5],
]

const Z = new THREE.Vector3(0, 0, 1)

/** Builds the skinned, furred puppy with its eyes, nose and tongue and adds it to the room. */
export function mountPuppyView(
  room: RoomScene,
  puppy: Puppy,
  built: PuppyGeometry,
  quality: Quality,
  place: { x: number; z: number; heading?: number } = { x: 0, z: 0 },
  care: Care = createCare(BREEDS[puppy.breedId], 0),
): PuppyView {
  const breed = BREEDS[puppy.breedId]
  const { geometry, anatomy: A } = built
  const bonePos = (name: string): Tuple3 => {
    const b = A.bones[A.bi[name] ?? -1]
    if (!b) throw new Error(`unknown bone "${name}"`)
    return b.pos
  }

  const group = new THREE.Group()
  const boneList = A.bones.map((b) => {
    const o = new THREE.Bone()
    o.name = b.name
    return o
  })
  const bones: Record<string, THREE.Bone> = {}
  A.bones.forEach((b, i) => {
    const o = boneList[i]!
    bones[b.name] = o
    const pp = b.parent ? bonePos(b.parent) : [0, 0, 0]
    o.position.set(b.pos[0] - pp[0]!, b.pos[1] - pp[1]!, b.pos[2] - pp[2]!)
    if (b.parent) bones[b.parent]!.add(o)
  })
  const bone = (name: string) => {
    const b = bones[name]
    if (!b) throw new Error(`unknown bone "${name}"`)
    return b
  }
  group.add(boneList[0]!)
  group.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(boneList)
  const ident = new THREE.Matrix4()
  // Fewer shells re-space and hide layers instead of compiling new materials
  const furU = furUniforms(breed.fur)
  const shells: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = []
  const setShells = (n: number) => {
    while (shells.length <= n) {
      const i = shells.length
      const m = new THREE.SkinnedMesh(geometry, furMaterial(0, furU))
      m.frustumCulled = false
      m.castShadow = i === 0
      m.renderOrder = i
      group.add(m)
      m.bind(skeleton, ident)
      shells.push(m)
    }
    shells.forEach((m, i) => {
      m.visible = i <= n
      if (m.visible) setFurHeight(m.material, i / n)
    })
  }
  setShells(quality.shells)

  const head = bone('head'),
    headPos = bonePos('head')
  const local = (p: Tuple3) =>
    new THREE.Vector3(p[0] - headPos[0], p[1] - headPos[1], p[2] - headPos[2])
  const eyeMat = eyeMaterial(eyeTexture(breed.iris)),
    lidMat = lidMaterial()
  const eyeGeo = new THREE.SphereGeometry(A.eyeR, 48, 28)
  eyeGeo.rotateX(Math.PI / 2)
  const lidSkin = RIM.clone().lerp(A.lidColor, 0.25)
  const upperLid = lidGeometry(A.eyeR * 1.03, lidSkin),
    lowerLid = lidGeometry(A.eyeR * 1.025, lidSkin, true)
  const glints = GLINTS.map(([d, r, o]) => ({
    n: new THREE.Vector3(...d).normalize(),
    geo: new THREE.CircleGeometry(A.eyeR * r, 20),
    mat: glintMaterial(o),
  }))
  const eyes = A.eyeBalls.map((e): EyeRig => {
    const pivot = new THREE.Object3D()
    pivot.position.copy(local(e.c))
    pivot.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...e.dir))
    head.add(pivot)
    const ball = new THREE.Mesh(eyeGeo, eyeMat)
    const lids = new THREE.Group()
    lids.rotation.z = -Math.sign(e.c[0]) * 0.12
    const lid = new THREE.Mesh(upperLid, lidMat)
    const low = new THREE.Mesh(lowerLid, lidMat)
    lid.rotation.x = LID_OPEN
    low.rotation.x = LOW_LID
    lids.add(lid, low)
    pivot.add(ball, lids)
    for (const g of glints) {
      const glint = new THREE.Mesh(g.geo, g.mat)
      glint.position.copy(g.n).multiplyScalar(A.eyeR * 1.006)
      glint.quaternion.setFromUnitVectors(Z, g.n)
      pivot.add(glint)
    }
    return { pivot, ball, lid, low }
  })
  const noseMat = noseMaterial(breed.nose)
  const noseGeo = noseGeometry()
  const nose = new THREE.Mesh(noseGeo, noseMat)
  nose.scale.set(...A.nose.rad)
  nose.position.copy(local(A.nose.c))
  head.add(nose)
  const mi = A.mouthInfo
  const tongueMat = tongueMaterial()
  const tongue = makeTongue(tongueMat)
  tongue.position.set(0, 0.002, mi.mEnd - 0.035 - mi.hinge[2])
  bone('jaw').add(tongue)
  shapeTongue(tongue, 0)

  const rest: Record<string, THREE.Vector3> = {}
  for (const [k, o] of Object.entries(bones)) rest[k] = o.position.clone()
  const zones = A.zones.map((z): ZoneRig => {
    const bp = bonePos(z.b)
    return {
      zone: z.zone,
      bone: bone(z.b),
      off: new THREE.Vector3(z.c[0] - bp[0], z.c[1] - bp[1], z.c[2] - bp[2]),
      r: z.r,
    }
  })

  const motion = createMotionState()
  motion.pos.set(place.x, 0, place.z)
  motion.heading = place.heading ?? 0
  const legs = createLegStates(legRigs(A), motion)
  group.position.set(motion.pos.x, 0, motion.pos.z)
  group.rotation.y = motion.heading

  const view: PuppyView = {
    ...behaviourRig(breed, puppy.persona, A),
    puppy,
    breed,
    anatomy: A,
    group,
    bones,
    rest,
    eyes,
    tongue,
    zones,
    legBones: LEG_BONES.map(([up, lo, end]) => ({ up: bone(up), lo: bone(lo), end: bone(end) })),
    legs,
    motion,
    fetch: createFetchState(),
    behaviour: createBehaviourState(),
    routine: createRoutineState(),
    care,
    bowl: 0,
    snoreT: 0,
    place: 0,
    mouth: new THREE.Vector3(0, -0.01, mi.mEnd + 0.045 - mi.hinge[2]),
    reach: A.tongue[2] - 0.12,
    setQuality: (q) => setShells(q.shells),
    dispose() {
      room.remove(view)
      for (const m of shells) m.material.dispose()
      for (const m of [eyeMat, lidMat, noseMat, tongueMat]) m.dispose()
      for (const g of [eyeGeo, upperLid, lowerLid, noseGeo, tongue.geometry]) g.dispose()
      for (const g of glints) {
        g.geo.dispose()
        g.mat.dispose()
      }
      skeleton.dispose()
    },
  }
  room.add(view)
  return view
}

const tmp = new THREE.Vector3()

/**
 * The puppy part under the ray. The belly only counts while it lies down or shows its belly,
 * otherwise a stroke under the body would land on the back.
 */
export function hitZone(
  view: Pick<PuppyView, 'motion' | 'zones'>,
  ray: THREE.Ray,
): { zone: ZoneId; point: THREE.Vector3; distance: number } | null {
  const lying = view.motion.pose !== 'stand' && view.motion.pose !== 'sit'
  let best: ZoneRig | null = null,
    bt = Infinity
  for (const z of view.zones) {
    if (z.zone === 'belly' && !lying) continue
    const t = raySphere(ray, z.bone.localToWorld(tmp.copy(z.off)), z.r)
    if (t > 0 && t < bt) {
      bt = t
      best = z
    }
  }
  return best ? { zone: best.zone, point: ray.at(bt, new THREE.Vector3()), distance: bt } : null
}

/**
 * The puppy's rest-pose bounds where its group stands. The box is measured once on the geometry
 * every view of the breed shares, so no shell is skinned to find it.
 */
export function restBounds(geometry: THREE.BufferGeometry, group: THREE.Object3D): THREE.Box3 {
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  return geometry.boundingBox!.clone().applyMatrix4(group.matrixWorld)
}

/** The nearest hit among several puppies. */
export function hitPuppy(
  views: PuppyView[],
  ray: THREE.Ray,
): (PuppyHit & { view: PuppyView }) | null {
  let best: (PuppyHit & { view: PuppyView }) | null = null
  for (const view of views) {
    const h = hitZone(view, ray)
    if (h && (!best || h.distance < best.distance)) best = { ...h, view }
  }
  return best
}

const plane = new THREE.Plane(),
  camDir = new THREE.Vector3()

/** The puppy follows the pointer with its eyes: where the ray crosses a plane through its face. */
export function pointLook(view: PuppyView, ray: THREE.Ray, camera: THREE.Camera, now: number) {
  plane.setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(camDir).negate(),
    view.group.localToWorld(tmp.copy(view.look)),
  )
  if (ray.intersectPlane(plane, view.behaviour.pointerLook)) view.behaviour.pointerAt = now
}

export interface PuppyTickCtx {
  room: RoomScene
  ball: BallState
  /** Seconds, on the pointer clock. */
  now: number
  /** The puppy the finger is stroking, if any. */
  petting: PuppyView | null
  /** Wall-clock milliseconds for bedtime; without it, or without furniture, no routines run. */
  clock?: number
  random?: () => number
}

export const mouthWorld = (view: PuppyView, out: Vec3): Vec3 =>
  view.bones.jaw!.localToWorld(out.copy(view.mouth))

/** Smallest distance kept between two puppies' bodies. */
const PERSONAL_SPACE = 0.45
const SNORE = 1.2
/** Just woken, a puppy walks this far in front of the room's middle to say hello. */
const HELLO = 0.35
/** Head down to eat it bows less than to pick up a ball, so its mouth meets the floor nearer. */
const EAT_REACH = 0.7
/** A full tummy: a burst of wagging. */
const FED_HAPPY = 0.35

/**
 * One frame of the puppies in the room: fetch, routine, poses and steps for each, then they are
 * kept apart, then character and bones. A ball in a mouth is placed again after the bones move so it
 * does not trail the jaw by a frame. Returns each puppy's fetch events, in order.
 */
export function tickPuppies(
  views: PuppyView[],
  ctx: PuppyTickCtx,
  dt: number,
  t: number,
): FetchEvents[] {
  const { ball, room } = ctx
  const moved = views.map((view) => {
    const M = view.motion
    const ev = stepFetch(
      view.fetch,
      M,
      ball,
      {
        reach: view.reach,
        cam: room.cam,
        mouthWorld: (out) => mouthWorld(view, out),
        mood: view.behaviour,
        energy: view.persona.energy,
        ...(ctx.random && { random: ctx.random }),
      },
      dt,
    )
    const spots = room.furniture?.spots
    if (spots && ctx.clock != null) {
      const r = stepRoutine(
        view.routine,
        M,
        {
          now: ctx.clock,
          care: view.care,
          spots,
          place: view.place,
          breed: view.breed,
          bowl: view.bowl,
          muzzle: view.reach * EAT_REACH,
          clamp: (x, z) => clampPlay(room.cam, x, z),
          busy: view.fetch.task !== 'free',
        },
        dt,
      )
      view.care = r.care
      view.bowl = r.bowl
      if (r.fed) {
        view.behaviour.happy = Math.min(1, view.behaviour.happy + FED_HAPPY)
        view.behaviour.perk = 1
      }
      if (r.yawn) yawn(view.behaviour)
      if (r.woke) {
        const { fx, fz } = playAxes(room.cam)
        goTo(M, room.cam.target.x - fx * HELLO, room.cam.target.z - fz * HELLO, {
          happy: view.behaviour.happy,
          energy: view.persona.energy,
          clamp: (x, z) => clampPlay(room.cam, x, z),
          ...(ctx.random && { random: ctx.random }),
        })
      }
    }
    stepPoses(M, dt)
    return { ev, body: stepLocomotion(M, view.legs, dt) }
  })
  if (room.furniture) showBowls(room.furniture, views)
  if (views.length > 1)
    separate(
      views.map((v) => v.motion),
      PERSONAL_SPACE,
      (x, z) => clampPlay(room.cam, x, z),
    )
  cameraPosition(room.cam, camPos)
  views.forEach((view, i) => {
    const s = view.behaviour,
      M = view.motion,
      { body } = moved[i]!
    view.group.position.set(M.pos.x, 0, M.pos.z)
    view.group.rotation.y = M.heading
    view.group.updateMatrixWorld(true)
    const pose = stepBehaviour(
      view,
      s,
      {
        now: ctx.now,
        petting: ctx.petting === view,
        petHeadX: view.bones.head!.worldToLocal(tmp.copy(s.petPoint)).x,
        motion: M,
        body,
        fetch: view.fetch,
        ball,
        camera: camPos,
        routine: view.routine.routine,
        ...(ctx.random && { random: ctx.random }),
      },
      dt,
      t,
    )
    applyPose(view, pose, body, dt, t)
    view.group.updateMatrixWorld(true)
    if (view.fetch.holding) mouthWorld(view, ball.pos)
    if (M.pose === 'sleep' && M.sleepW > 0.8) {
      view.snoreT -= dt
      if (view.snoreT <= 0) {
        view.snoreT = SNORE
        headWorld(view, tmp).y += 0.14
        room.emitZ(tmp)
      }
    } else view.snoreT = 0
  })
  return moved.map((m) => m.ev)
}

const camPos = new THREE.Vector3()
const eul = new THREE.Euler(0, 0, 0, 'YXZ')
const setRot = (o: THREE.Object3D, r: readonly [number, number, number]) =>
  o.quaternion.setFromEuler(eul.set(r[0], r[1], r[2], 'YXZ'))

/** Thin layer: writes the behaviour pose onto the bones and solves the legs. */
function applyPose(view: PuppyView, pose: BehaviourPose, body: BodyPose, dt: number, t: number) {
  const b = view.bones,
    M = view.motion,
    fk = M.fk,
    sc = pose.scratch
  for (const e of view.eyes) {
    e.lid.rotation.x = pose.lid
    e.low.rotation.x = pose.lowLid
    const l = e.pivot.worldToLocal(tmp.copy(pose.target))
    const gy = clamp(Math.atan2(l.x, l.z) + pose.sacc.x, -0.42, 0.42)
    const gx = clamp(-Math.atan2(l.y, Math.hypot(l.x, l.z)) + pose.sacc.y, -0.3, 0.3)
    e.ball.rotation.set(damp(e.ball.rotation.x, gx, 30, dt), damp(e.ball.rotation.y, gy, 30, dt), 0)
  }
  setRot(b.neck!, pose.neck)
  setRot(b.head!, pose.head)
  setRot(b.spine!, pose.spine)
  b.spine!.position.y = view.rest.spine!.y + pose.spineDy
  b.chest!.position.y = view.rest.chest!.y + pose.chestDy
  setRot(b.pelvis!, pose.pelvis)

  // Legs: inverse kinematics towards each paw's footfall, in the leg's parent frame
  view.group.updateMatrixWorld(true)
  view.legs.forEach((L, i) => {
    const lb = view.legBones[i]!
    let [a1, a2, a3] = solveTwoBone(
      L.rig,
      lb.up.parent!.worldToLocal(tmp.copy(L.pos)),
      body.pitch,
      L.s,
    )
    if (fk > 0.001) {
      const lp = M.legPose[i]!,
        kick = M.bellyW * (i < 2 ? 0.25 * Math.sin(t * 6 + i * 2) : 0.2 * Math.sin(t * 5 + i * 2.5))
      a1 += (lp[0] + kick - a1) * fk
      a2 += (lp[1] - a2) * fk
      a3 += (lp[2] + kick - a3) * fk
    }
    if (i === 3 && sc > 0.01) {
      a1 += (SCRATCH[0] - 0.28 * Math.sin(t * 19) - a1) * sc
      a2 += (SCRATCH[1] - a2) * sc
      a3 += (SCRATCH[2] - a3) * sc
    }
    const splay =
      (i === 3 ? -0.22 * sc : 0) + (i % 2 ? -1 : 1) * (M.spread * fk + (i >= 2 ? 0.22 * M.sit : 0))
    setRot(lb.up, [a1, 0, splay])
    setRot(lb.lo, [a2, 0, 0])
    setRot(lb.end, [a3, 0, 0])
  })

  setRot(b.tail0!, pose.tail[0])
  setRot(b.tail1!, pose.tail[1])
  setRot(b.tail2!, pose.tail[2])
  view.anatomy.ears.forEach((ear, i) => {
    const e = pose.ears[i]!
    setRot(b[ear.nm]!, e.base)
    if (ear.tip) setRot(b[ear.tip]!, e.tip)
  })
  setRot(b.jaw!, [pose.jaw, 0, 0])
  shapeTongue(view.tongue, pose.tongue)
}

export function headWorld(view: PuppyView, out: Vec3 = new THREE.Vector3()): Vec3 {
  return view.bones.head!.getWorldPosition(out)
}

/** Asleep, or too hungry to leave its meal: the ball goes on without it. */
const away = (v: Pick<PuppyView, 'routine' | 'care'>) =>
  v.routine.routine === 'sleeping' || keepsEating(v.routine, v.care)

/**
 * The ball comes out: the puppies awake stand and wait for the throw; sleepers sleep on and a
 * very hungry one eats on.
 */
export function offerBall(
  views: Pick<PuppyView, 'motion' | 'fetch' | 'behaviour' | 'routine' | 'care'>[],
  ball: BallState,
): void {
  if (ball.state === 'mouth') return
  ball.state = 'hand'
  ball.vel.set(0, 0, 0)
  for (const v of views) {
    if (away(v)) continue
    setPose(v.motion, 'stand')
    v.fetch.task = 'wait'
    v.fetch.taskT = 0
    v.motion.goal = null
    v.behaviour.perk = 1
  }
}

export function putBallAway(views: PuppyView[], ball: BallState): void {
  ball.state = 'none'
  for (const v of views) if (v.fetch.task === 'wait') v.fetch.task = 'free'
}

/** Every puppy awake and not deep in a meal perks up at the throw; one goes for it, or two race. */
export function throwBall(
  views: PuppyView[],
  ball: BallState,
  vel: Vec3,
  random: () => number = Math.random,
): void {
  ball.vel.copy(vel)
  ball.state = 'air'
  for (const v of views) {
    if (away(v)) continue
    v.fetch.task = 'chase'
    v.fetch.taskT = 0
    v.behaviour.perk = 1
    setPose(v.motion, 'stand')
  }
  claimBall(
    views.map((v) => v.fetch),
    views.map((v) => v.motion),
    ball,
    {
      random,
      energies: views.map((v) => v.persona.energy),
      mouths: views.map((v) => mouthWorld(v, new THREE.Vector3())),
    },
  )
}

/**
 * Asks for a trick; only while the puppy is not playing ball or deep in a meal. A sleeping one
 * wakes instead.
 */
export function askTrick(view: PuppyView, pose: Exclude<PoseId, 'stand' | 'sleep'>): boolean {
  if (touch(view.routine) || view.fetch.task !== 'free' || keepsEating(view.routine, view.care))
    return false
  setPose(view.motion, pose)
  view.behaviour.happy = Math.min(1, view.behaviour.happy + 0.05)
  return true
}
