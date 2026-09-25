import type { RoomInfo, PlayerInfo, CreateRoomRequest } from '../../../shared/src/messages.ts'

export class RoomManager {
  private rooms = new Map<string, RoomInfo>()

  /**
   * Create a new multiplayer room.
   */
  public createRoom(hostPlayer: PlayerInfo, options: CreateRoomRequest): RoomInfo {
    const roomId = `room_${Math.random().toString(36).substring(2, 8)}`
    const roomName = (options.name && options.name.trim()) || `Oda #${roomId.slice(-4).toUpperCase()}`

    const room: RoomInfo = {
      id: roomId,
      name: roomName,
      mode: options.mode || 'CITY_FREE_ROAM',
      map: options.map || 'CITY',
      maxPlayers: Math.min(Math.max(options.maxPlayers || 8, 2), 16),
      currentPlayers: 1,
      players: [{ ...hostPlayer, isHost: true }],
      hostId: hostPlayer.id,
      createdAt: Date.now(),
    }

    this.rooms.set(roomId, room)
    return room
  }

  public getRoom(roomId: string): RoomInfo | undefined {
    return this.rooms.get(roomId)
  }

  public getAllRooms(): RoomInfo[] {
    return Array.from(this.rooms.values())
  }

  public getRoomCount(): number {
    return this.rooms.size
  }

  /**
   * Join an existing room.
   */
  public joinRoom(roomId: string, player: PlayerInfo): { success: boolean; error?: string; room?: RoomInfo } {
    const room = this.rooms.get(roomId)
    if (!room) {
      return { success: false, error: 'Oda bulunamadı' }
    }

    if (room.players.length >= room.maxPlayers) {
      return { success: false, error: 'Oda dolu' }
    }

    const existingIndex = room.players.findIndex(p => p.id === player.id)
    if (existingIndex !== -1) {
      // Player already in room, update data
      room.players[existingIndex] = { ...player, isHost: room.players[existingIndex].isHost }
      return { success: true, room }
    }

    room.players.push({ ...player, isHost: false })
    room.currentPlayers = room.players.length

    return { success: true, room }
  }

  /**
   * Leave a room. Reassigns host if needed or deletes room if empty.
   */
  public leaveRoom(roomId: string, playerId: string): { left: boolean; roomDeleted: boolean; room?: RoomInfo } {
    const room = this.rooms.get(roomId)
    if (!room) {
      return { left: false, roomDeleted: false }
    }

    const initialCount = room.players.length
    room.players = room.players.filter(p => p.id !== playerId)
    room.currentPlayers = room.players.length

    if (room.players.length === 0) {
      this.rooms.delete(roomId)
      return { left: true, roomDeleted: true }
    }

    // If host left, assign host to the first remaining player
    if (room.hostId === playerId && room.players.length > 0) {
      room.players[0].isHost = true
      room.hostId = room.players[0].id
    }

    return { left: initialCount !== room.players.length, roomDeleted: false, room }
  }

  /**
   * Find which room a player is currently in.
   */
  public findRoomByPlayerId(playerId: string): RoomInfo | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.some(p => p.id === playerId)) {
        return room
      }
    }
    return undefined
  }
}
