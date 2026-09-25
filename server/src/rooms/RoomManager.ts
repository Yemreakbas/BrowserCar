import { DEFAULT_GLOBAL_ROOM_ID } from '../../../shared/src/constants.ts'
import type {
  RoomInfo,
  PlayerInfo,
  CreateRoomRequest,
  PlayerStateMessage,
  AuthoritativePlayerState,
  RoomSnapshotPayload,
} from '../../../shared/src/messages.ts'

export class RoomManager {
  private rooms = new Map<string, RoomInfo>()
  private playerStatesByRoom = new Map<string, Map<string, AuthoritativePlayerState>>()

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
  public joinRoom(roomId: string, player: PlayerInfo): { success: boolean; error?: string; room?: RoomInfo; player?: PlayerInfo } {
    const room = this.rooms.get(roomId)
    if (!room) {
      return { success: false, error: 'Oda bulunamadı' }
    }

    if (room.players.length >= room.maxPlayers) {
      return { success: false, error: 'Oda dolu' }
    }

    const existingIndex = room.players.findIndex(p => p.id === player.id)
    if (existingIndex !== -1) {
      const merged = { ...room.players[existingIndex], ...player }
      room.players[existingIndex] = merged
      return { success: true, room, player: merged }
    }

    const spawnIndex = room.players.length % 4
    const isHost = room.players.length === 0 && room.id !== DEFAULT_GLOBAL_ROOM_ID
    const updatedPlayer: PlayerInfo = { ...player, isHost, spawnIndex }
    room.players.push(updatedPlayer)
    room.currentPlayers = room.players.length

    if (isHost) {
      room.hostId = player.id
    }

    if (!this.playerStatesByRoom.has(roomId)) {
      this.playerStatesByRoom.set(roomId, new Map())
    }

    return { success: true, room, player: updatedPlayer }
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
        room.hostId = 'system'
        return { left: true, roomDeleted: false, room }
      }
      this.rooms.delete(roomId)
      this.playerStatesByRoom.delete(roomId)
      return { left: true, roomDeleted: true }
    }

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
   * Authoritative validation of incoming client telemetry.
   * Performs bounds checking, speed/displacement sanity checks, and returns validated state
   * along with flag indicating if client needs state reconciliation.
   */
  public validateAndUpdatePlayerState(
    state: PlayerStateMessage,
    serverTick: number
  ): { valid: boolean; state?: AuthoritativePlayerState; needsCorrection: boolean; correctionReason?: string } {
    if (
      !state.position ||
      state.position.length !== 3 ||
      !state.position.every(n => Number.isFinite(n)) ||
      !state.rotation ||
      state.rotation.length !== 4 ||
      !state.rotation.every(n => Number.isFinite(n))
    ) {
      return {
        valid: false,
        needsCorrection: false,
      }
    }

    let roomStates = this.playerStatesByRoom.get(state.roomId)
    if (!roomStates) {
      roomStates = new Map()
      this.playerStatesByRoom.set(state.roomId, roomStates)
    }

    const prev = roomStates.get(state.playerId)
    let validatedPos: [number, number, number] = [...state.position]
    let validatedRot: [number, number, number, number] = [...state.rotation]
    let validatedVel: [number, number, number] = state.velocity ? [...state.velocity] : [0, 0, 0]
    let needsCorrection = false
    let correctionReason: string | undefined = undefined

    // 1. Playable World Bounds Check (Prevent falling out of world or extreme NaN/teleports)
    if (
      validatedPos[1] < -25 ||
      validatedPos[1] > 200 ||
      Math.abs(validatedPos[0]) > 1500 ||
      Math.abs(validatedPos[2]) > 1500
    ) {
      validatedPos = [0, 0.45, 0]
      validatedRot = [0, 0, 0, 1]
      validatedVel = [0, 0, 0]
      needsCorrection = true
      correctionReason = 'OUT_OF_BOUNDS'
    } else if (state.isRespawn) {
      // 2. Synchronized Respawn / Spawn Cycling: Accept position without displacement penalty
      needsCorrection = false
      correctionReason = undefined
    } else if (prev) {
      // 3. Displacement & Speed Sanity Check
      const dt = Math.max(0.01, (state.timestamp - prev.timestamp) / 1000)
      const dx = state.position[0] - prev.position[0]
      const dy = state.position[1] - prev.position[1]
      const dz = state.position[2] - prev.position[2]
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      // Max allowed speed: ~55 m/s (~200 km/h) + jitter buffer (10 meters)
      const maxAllowed = 55 * dt + 10.0
      if (dist > maxAllowed && dist > 35) {
        const scale = maxAllowed / dist
        validatedPos = [
          prev.position[0] + dx * scale,
          prev.position[1] + dy * scale,
          prev.position[2] + dz * scale,
        ]
        needsCorrection = true
        correctionReason = 'EXCESSIVE_DISPLACEMENT'
      }
    }

    const authState: AuthoritativePlayerState = {
      playerId: state.playerId,
      playerName: state.playerName,
      roomId: state.roomId,
      position: validatedPos,
      rotation: validatedRot,
      velocity: validatedVel,
      speed: Math.max(-40, Math.min(220, state.speed || 0)),
      steering: Math.max(-0.65, Math.min(0.65, state.steering || 0)),
      isBraking: !!state.isBraking,
      isDrifting: !!state.isDrifting,
      lastProcessedSequence: state.sequence || 0,
      isRespawn: !!state.isRespawn,
      timestamp: Date.now(),
    }

    roomStates.set(state.playerId, authState)

    return {
      valid: true,
      state: authState,
      needsCorrection,
      correctionReason,
    }
  }

  /**
   * Get authoritative snapshot of all active vehicles in a given room.
   */
  public getRoomSnapshot(roomId: string, serverTick: number): RoomSnapshotPayload | null {
    const roomStates = this.playerStatesByRoom.get(roomId)
    if (!roomStates || roomStates.size === 0) return null
    return {
      roomId,
      serverTick,
      serverTime: Date.now(),
      states: Array.from(roomStates.values()),
    }
  }
}
