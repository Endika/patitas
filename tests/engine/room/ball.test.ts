// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BREEDS } from '@/domain/breeds'
import type { PoseId } from '@/engine/motion/poses'
import { anatomy } from '@/engine/puppy/anatomy'
import {
  BALL_R,
  bounceOff,
  createBall,
  rollOut,
  stepBall,
  throwVelocity,
  type BallState,
} from '@/engine/room/ball'
import { bodyOf, bodyShape, createBody, sphereAt, SPHERES, type Body } from '@/engine/room/bodies'
import {
  createCamera,
  fitCamera,
  PLAY,
  playLocal,
  playWorld,
  type FixedCamera,
} from '@/engine/room/camera'
import { seeded } from '../seeded'

const DT = 1 / 60

/** How far the ball is outside the play area (0 when inside). */
function outside(cam: FixedCamera, ball: BallState) {
  const q = playLocal(cam, ball.pos.x, ball.pos.z)
  return Math.max(0, q.d - PLAY.far, PLAY.near - q.d, Math.abs(q.side) - q.half)
}

function placeLocal(cam: FixedCamera, ball: BallState, d: number, side: number) {
  const { fx, fz } = playLocal(cam, 0, 0)
  ball.pos.set(cam.target.x + fx * d - fz * side, BALL_R, cam.target.z + fz * d + fx * side)
}

describe('stepBall', () => {
  it.each([
    ['portrait to landscape', 0.46, 2.1],
    ['landscape to portrait', 2.1, 0.46],
  ])('brings a resting ball back inside after the screen turns (%s)', (_, from, to) => {
    const cam = fitCamera(createCamera(), from)
    const ball = createBall()
    ball.state = 'air'
    const edge = playLocal(cam, cam.target.x, cam.target.z).half
    placeLocal(cam, ball, 0.4, -edge)
    fitCamera(cam, to)
    const q = playLocal(cam, ball.pos.x, ball.pos.z)
    // In the turn that widens the frame, the old edge is inside: push it past the new one
    if (outside(cam, ball) === 0) placeLocal(cam, ball, 0.4, -q.half - 0.6)
    expect(outside(cam, ball)).toBeGreaterThan(0.3)

    let back = Infinity
    for (let n = 0; n < 180; n++) {
      const before = ball.pos.clone()
      stepBall(ball, cam, DT)
      expect(ball.pos.distanceTo(before)).toBeLessThanOrEqual(0.1)
      if (outside(cam, ball) === 0 && back === Infinity) back = n * DT
    }
    expect(back).toBeLessThan(3)
    expect(outside(cam, ball)).toBe(0)
  })

  it('keeps a thrown ball inside the frame and lets it come to rest', () => {
    const cam = fitCamera(createCamera(), 0.46)
    const ball = createBall()
    const v = throwVelocity(cam, { vx: 500, vy: 2600 })
    expect(v).not.toBeNull()
    ball.state = 'air'
    placeLocal(cam, ball, PLAY.near, 0)
    ball.pos.y = 0.3
    ball.vel.copy(v!)
    let worst = 0
    for (let n = 0; n < 600; n++) {
      stepBall(ball, cam, DT)
      worst = Math.max(worst, outside(cam, ball))
    }
    expect(worst).toBeLessThanOrEqual(0.05)
    expect(ball.vel.length()).toBeLessThan(0.01)
    expect(ball.pos.y).toBeCloseTo(BALL_R)
  })

  it('rolls the ball as it moves on the floor', () => {
    const cam = fitCamera(createCamera(), 1)
    const ball = createBall()
    ball.state = 'air'
    placeLocal(cam, ball, 0, 0)
    ball.vel.set(0.5, 0, 0)
    stepBall(ball, cam, DT)
    expect(ball.rot.z).toBeLessThan(0)
  })

  it.each(['bone', 'plush'] as const)(
    'lets the %s bounce less than the ball and slide to a stop sooner, turning instead of rolling',
    (toy) => {
      const cam = fitCamera(createCamera(), 1)
      const drop = (which: BallState['toy']) => {
        const ball: BallState = { ...createBall(), toy: which, state: 'air', spin: 5 }
        placeLocal(cam, ball, 0, 0)
        ball.pos.y = 0.5
        ball.vel.set(0.8, 0, 0)
        let bounce = 0,
          landed = false,
          still = Infinity
        for (let n = 0; n < 240; n++) {
          stepBall(ball, cam, DT)
          if (ball.pos.y <= BALL_R + 1e-6) landed = true
          else if (landed) bounce = Math.max(bounce, ball.pos.y - BALL_R)
          if (still === Infinity && Math.hypot(ball.vel.x, ball.vel.z) < 0.01) still = n
        }
        return { ball, bounce, still }
      }
      const rolled = drop('ball'),
        thrown = drop(toy)
      expect(thrown.bounce).toBeLessThan(rolled.bounce)
      expect(thrown.still).toBeLessThan(rolled.still)
      expect(thrown.ball.rot.z).toBe(0)
      expect(thrown.ball.yaw).not.toBe(0)
    },
  )

  it('leaves a ball that is not in the air alone', () => {
    const cam = fitCamera(createCamera(), 1)
    const ball = createBall()
    ball.state = 'hand'
    ball.pos.set(0, 1, 0)
    stepBall(ball, cam, DT)
    expect(ball.pos.y).toBe(1)
  })
})

describe('throwVelocity', () => {
  const cam = fitCamera(createCamera(), 0.46)

  it('does not throw on a slow or downward swipe', () => {
    expect(throwVelocity(cam, { vx: 0, vy: 150 })).toBeNull()
    expect(throwVelocity(cam, { vx: 300, vy: -900 })).toBeNull()
  })

  it('throws a gentle upward swipe as hard as a 650 px/s one', () => {
    expect(throwVelocity(cam, { vx: 0, vy: 200 })).toEqual(throwVelocity(cam, { vx: 0, vy: 650 }))
  })

  it('throws away from the camera, upwards', () => {
    const v = throwVelocity(cam, { vx: 0, vy: 1300 })!
    const q = playLocal(cam, 0, 0)
    expect(v.x * q.fx + v.z * q.fz).toBeCloseTo(2)
    expect(v.y).toBeCloseTo(1.4 + 2 * 0.35)
  })
})

const SHAPE = bodyShape(anatomy(BREEDS.beagle))

function puppyAt(x: number, z: number, heading: number, pose: PoseId = 'stand'): Body {
  return bodyOf({ x, z }, heading, pose, SHAPE, createBody())
}

/** How far the ball is from touching the nearest sphere: negative while inside one. */
function clearance(ball: BallState, bodies: readonly Body[]) {
  let least = Infinity
  for (const b of bodies)
    for (let k = 0; k < SPHERES; k++) {
      const s = sphereAt(b, k)
      least = Math.min(
        least,
        Math.hypot(ball.pos.x - s.x, ball.pos.y - s.y, ball.pos.z - s.z) - s.r - BALL_R,
      )
    }
  return least
}

describe('bounceOff', () => {
  const cam = fitCamera(createCamera(), 2.1)

  it('bounces a ball thrown at a standing puppy back, never letting it in', () => {
    const random = seeded(5)
    let hits = 0
    for (let n = 0; n < 40; n++) {
      const [x, z] = playWorld(cam, 0.6, 0)
      const body = puppyAt(x, z, random() * Math.PI * 2)
      const aim = sphereAt(body, Math.floor(random() * SPHERES)),
        from = random() * Math.PI * 2
      const ball: BallState = { ...createBall(), state: 'air' }
      ball.pos.set(aim.x + Math.sin(from) * 0.7, aim.y + 0.1, aim.z + Math.cos(from) * 0.7)
      // A lob that would reach the sphere's middle in `t`, gravity and all
      const t = 0.7 / (1.5 + random() * 2)
      ball.vel.set(
        (aim.x - ball.pos.x) / t,
        (aim.y - ball.pos.y) / t + 0.5 * 6.5 * t,
        (aim.z - ball.pos.z) / t,
      )
      let bounced = false
      for (let f = 0; f < 90; f++) {
        stepBall(ball, cam, DT)
        const v = ball.vel.clone()
        if (bounceOff(ball, [body], -1) && !bounced) {
          bounced = true
          hits++
          // Off the sphere it now touches: the speed into it comes back out at half
          let touching = 0
          for (let k = 0; k < SPHERES; k++) {
            const s = sphereAt(body, k)
            const nx = ball.pos.x - s.x,
              ny = ball.pos.y - s.y,
              nz = ball.pos.z - s.z,
              l = Math.hypot(nx, ny, nz)
            if (Math.abs(l - s.r - BALL_R) > 1e-6) continue
            const into = (v.x * nx + v.y * ny + v.z * nz) / l,
              out = (ball.vel.x * nx + ball.vel.y * ny + ball.vel.z * nz) / l
            expect(into).toBeLessThan(0)
            expect(out).toBeCloseTo(-0.5 * into, 6)
            touching++
          }
          expect(touching).toBeGreaterThan(0)
        }
        expect(clearance(ball, [body])).toBeGreaterThan(-1e-6)
      }
      expect(bounced).toBe(true)
    }
    expect(hits).toBe(40)
  })

  it('lets a ball rolled at a lying puppy come to rest within 2 s, rolled out at most once', () => {
    const [x, z] = playWorld(cam, 0.6, 0)
    const body = puppyAt(x, z, 0.4, 'lie')
    const ball: BallState = { ...createBall(), state: 'air' }
    const c = body.chest
    // Rolling at its flank, along the floor
    ball.pos.set(c.x + Math.cos(0.4) * 0.45, BALL_R, c.z - Math.sin(0.4) * 0.45)
    ball.vel.set(-Math.cos(0.4), 0, Math.sin(0.4)).multiplyScalar(0.9)
    let touched = false,
      rest = Infinity,
      last = Infinity,
      rolls = 0
    const before = ball.pos.clone()
    for (let f = 0; f < 60 * 4; f++) {
      before.copy(ball.pos)
      stepBall(ball, cam, DT)
      const hit = bounceOff(ball, [body], -1)
      touched ||= hit
      const rolled = rollOut(ball, [body], -1, cam, DT)
      if (rolled) rolls++
      expect(clearance(ball, [body])).toBeGreaterThan(-1e-6)
      const moved = ball.pos.distanceTo(before)
      if (rest === Infinity && ball.vel.length() < 0.05) rest = f * DT
      if (rest !== Infinity && !rolled) {
        // At rest it only slows down: no knock from the puppy, no step back
        expect(hit).toBe(false)
        expect(moved).toBeLessThanOrEqual(last + 1e-12)
      }
      last = rolled ? Infinity : moved
    }
    expect(touched).toBe(true)
    expect(rest).toBeLessThan(2)
    expect(rolls).toBeLessThanOrEqual(1)
    expect(ball.pos.y).toBeCloseTo(BALL_R)
  })

  it('on its own, keeps a ball lying against a puppy exactly where it is', () => {
    const [x, z] = playWorld(cam, 0.6, 0)
    const body = puppyAt(x, z, 0, 'lie')
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(body.chest.x + 0.1, BALL_R, body.chest.z)
    bounceOff(ball, [body], -1)
    ball.vel.set(0, 0, 0)
    const at = ball.pos.clone()
    for (let f = 0; f < 60 * 2; f++) {
      stepBall(ball, cam, DT)
      bounceOff(ball, [body], -1)
      expect(ball.pos.distanceTo(at)).toBeLessThan(1e-9)
    }
  })

  it.each([
    ['against a lying puppy', 'lie' as const, (b: Body) => [b.chest.x + 0.2, b.chest.z]],
    ['under a sleeper’s chin', 'sleep' as const, (b: Body) => [b.head.x, b.head.z]],
    ['under a standing puppy', 'stand' as const, (b: Body) => [b.chest.x, b.chest.z]],
  ])('rolls a ball left %s out once, after half a second', (_, pose, spot) => {
    const [x, z] = playWorld(cam, 0.6, 0)
    const body = puppyAt(x, z, 0, pose)
    const ball: BallState = { ...createBall(), state: 'air' }
    const [bx, bz] = spot(body)
    ball.pos.set(bx!, BALL_R, bz!)
    bounceOff(ball, [body], -1)
    ball.vel.set(0, 0, 0)
    const rolls: number[] = []
    for (let f = 0; f < 60 * 4; f++) {
      stepBall(ball, cam, DT)
      bounceOff(ball, [body], -1)
      if (rollOut(ball, [body], -1, cam, DT)) rolls.push(f * DT)
    }
    expect(rolls).toHaveLength(1)
    expect(rolls[0]).toBeGreaterThan(0.45)
    expect(rolls[0]).toBeLessThan(0.6)
    expect(clearance(ball, [body])).toBeGreaterThan(0.02)
    expect(ball.vel.length()).toBeLessThan(0.05)
  })

  it('rolls a ball hemmed in against the edge towards the middle of the play area', () => {
    // Lying across the far edge's middle, the ball between it and the edge
    const [x, z] = playWorld(cam, PLAY.far - 0.3, 0)
    const { fx, fz } = playLocal(cam, x, z)
    const body = puppyAt(x, z, Math.atan2(-fz, fx), 'lie')
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(body.chest.x + fx * 0.18, BALL_R, body.chest.z + fz * 0.18)
    bounceOff(ball, [body], -1)
    let rolled = false
    for (let f = 0; f < 60 && !rolled; f++) {
      ball.vel.set(0, 0, 0)
      rolled = rollOut(ball, [body], -1, cam, DT)
    }
    expect(rolled).toBe(true)
    // It rolls clear without running into the edge
    for (let f = 0; f < 60 * 3; f++) {
      stepBall(ball, cam, DT)
      bounceOff(ball, [body], -1)
      expect(outside(cam, ball)).toBe(0)
    }
    expect(clearance(ball, [body])).toBeGreaterThan(0.02)
  })

  it('leaves alone a ball the catcher is over, or one lying in the open', () => {
    const [x, z] = playWorld(cam, 0.6, 0)
    const body = puppyAt(x, z, 0, 'stand')
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(body.chest.x, BALL_R, body.chest.z)
    for (let f = 0; f < 60; f++) expect(rollOut(ball, [body], 0, cam, DT)).toBe(false)
    ball.pos.set(body.chest.x + 1, BALL_R, body.chest.z)
    for (let f = 0; f < 60; f++) expect(rollOut(ball, [body], -1, cam, DT)).toBe(false)
  })

  it('pushes out a ball a puppy lies down on, along the floor', () => {
    const [x, z] = playWorld(cam, 0.6, 0)
    const body = puppyAt(x, z, 0, 'lie')
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(body.chest.x + 0.05, BALL_R, body.chest.z)
    expect(bounceOff(ball, [body], -1)).toBe(true)
    expect(ball.pos.y).toBe(BALL_R)
    expect(clearance(ball, [body])).toBeGreaterThan(-1e-6)
  })

  it('goes through the puppy that catches it, and leaves a ball not in the air alone', () => {
    const body = puppyAt(0, 0, 0)
    const ball: BallState = { ...createBall(), state: 'air' }
    ball.pos.set(body.head.x, body.head.y, body.head.z)
    expect(bounceOff(ball, [body], 0)).toBe(false)
    expect(ball.pos.z).toBe(body.head.z)
    ball.state = 'mouth'
    expect(bounceOff(ball, [body], -1)).toBe(false)
  })
})
