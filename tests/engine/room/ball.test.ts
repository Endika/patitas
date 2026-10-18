// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BALL_R, createBall, stepBall, throwVelocity, type BallState } from '@/engine/room/ball'
import { createCamera, fitCamera, PLAY, playLocal, type FixedCamera } from '@/engine/room/camera'

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
