import { DEFAULT_GLOBAL_ROOM_ID } from '../../../shared/src/constants.ts'
import type { RoomInfo, PlayerInfo, CreateRoomRequest, PlayerStateMessage } from '../../../shared/src/messages.ts'

export class RoomManager {
  private rooms = new Map<string, RoomInfo>()
  private playerStatesByRoom = new Map<string, Map<string, PlayerStateMessage>>()

  constructor() {
    this.initDefaultRooms()
  }

  /**
   * Initialize permanent default rooms (e.g. Global City Free Roam)
   */
  public initDefaultRooms(): void {
    const globalRoom: RoomInfo = {
      id: DEFAULT_GLOBAL_ROOM_ID,
      name: 'Şehir Serbest Sürüş (Genel)',
      mode: 'CITY_FREE_ROAM',
      map: 'CITY',
      maxPlayers: 32,
      currentPlayers: 0,
      players: [],
      hostId: 'system',
      createdAt: Date.now(),
    }
    this.rooms.set(DEFAULT_GLOBAL_ROOM_ID, globalRoom)
    this.playerStatesByRoom.set(DEFAULT_GLOBAL_ROOM_ID, new Map())
  }

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
    this.playerStatesByRoom.set(roomId, new Map())
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

    const isHost = room.players.length === 0 && room.id !== DEFAULT_GLOBAL_ROOM_ID
    room.players.push({ ...player, isHost })
    room.currentPlayers = room.players.length

    if (isHost) {
      room.hostId = player.id
    }

    if (!this.playerStatesByRoom.has(roomId)) {
      this.playerStatesByRoom.set(roomId, new Map())
    }

    return { success: true, room }
  }

  /**
   * Leave a room. Reassigns host if needed or deletes room if empty (except permanent rooms).
   */
  public leaveRoom(roomId: string, playerId: string): { left: boolean; roomDeleted: boolean; room?: RoomInfo } {
    const room = this.rooms.get(roomId)
    if (!room) {
      return { left: false, roomDeleted: false }
    }

    const initialCount = room.players.length
    room.players = room.players.filter(p => p.id !== playerId)
    room.currentPlayers = room.players.length

    // Remove state cache
    const roomStates = this.playerStatesByRoom.get(roomId)
    if (roomStates) {
      roomStates.delete(playerId)
    }

    if (room.players.length === 0) {
      if (roomId === DEFAULT_GLOBAL_ROOM_ID) {
        // Permanent room: do not delete, just reset host
        room.hostId = 'system'
        return { left: true, roomDeleted: false, room }
      }
      this.rooms.delete(roomId)
      this.playerStatesByRoom.delete(roomId)
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

  /**
   * Store and update the latest vehicle state for a player in a room.
   */
  public updatePlayerState(state: PlayerStateMessage): void {
    let roomStates = this.playerStatesByRoom.get(state.roomId)
    if (!roomStates) {
      roomStates = new Map()
      this.playerStatesByRoom.set(state.roomId, roomStates)
    }
    roomStates.set(state.playerId, state)
  }

  /**
   * Get all cached player vehicle states for a given room.
   */
  public getRoomSnapshot(roomId: string): PlayerStateMessage[] {
    const roomStates = this.playerStatesByRoom.get(roomId)
    if (!roomStates) return []
    return Array.from(roomStates.values())
  }
}
