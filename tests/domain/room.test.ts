import { describe, expect, it } from 'vitest'
import { enterRoom, leaveRoom, ROOM_CAPACITY, RoomFull } from '@/domain/room'

describe('room', () => {
  it('has capacity for two', () => {
    expect(ROOM_CAPACITY).toBe(2)
  })

  it('adds puppies without mutating the original room', () => {
    const empty = { inRoom: [] }
    const room = enterRoom(empty, 'a')
    expect(room.inRoom).toEqual(['a'])
    expect(empty.inRoom).toEqual([])
  })

  it('throws RoomFull when two are already inside', () => {
    expect(() => enterRoom({ inRoom: ['a', 'b'] }, 'c')).toThrow(RoomFull)
  })

  it('returns the same room when the puppy is already in', () => {
    const room = { inRoom: ['a', 'b'] }
    expect(enterRoom(room, 'a')).toEqual(room)
  })

  it('removes a puppy and tolerates one that is not there', () => {
    const room = { inRoom: ['a', 'b'] }
    expect(leaveRoom(room, 'a').inRoom).toEqual(['b'])
    expect(leaveRoom(room, 'z')).toEqual(room)
    expect(room.inRoom).toEqual(['a', 'b'])
  })
})
