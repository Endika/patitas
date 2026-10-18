export const ROOM_CAPACITY = 2

export interface Room {
  inRoom: string[]
}

export class RoomFull extends Error {
  constructor() {
    super(`The room only fits ${ROOM_CAPACITY} puppies`)
    this.name = 'RoomFull'
  }
}

export function enterRoom(room: Room, id: string): Room {
  if (room.inRoom.includes(id)) return room
  if (room.inRoom.length >= ROOM_CAPACITY) throw new RoomFull()
  return { inRoom: [...room.inRoom, id] }
}

export function leaveRoom(room: Room, id: string): Room {
  return { inRoom: room.inRoom.filter((other) => other !== id) }
}
