import { DEFAULT_GLOBAL_ROOM_ID, DEFAULT_RACE_ROOM_ID, DEFAULT_DRIFT_ROOM_ID, OnlineRaceState, OnlineDriftState } from '../../../shared/src/constants.ts'
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
   * Initialize permanent default rooms (Global City, Grand Prix Circuit, Drift Arena)
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

    const raceRoom: RoomInfo = {
      id: DEFAULT_RACE_ROOM_ID,
      name: 'Grand Prix Çevrimiçi Yarış Pisti',
      mode: 'RACE',
      map: 'RACE_TRACK',
      maxPlayers: 8,
      currentPlayers: 0,
      players: [],
      hostId: 'system',
      createdAt: Date.now(),
      raceState: OnlineRaceState.LOBBY,
      totalLaps: 2,
    }
    this.rooms.set(DEFAULT_RACE_ROOM_ID, raceRoom)
    this.playerStatesByRoom.set(DEFAULT_RACE_ROOM_ID, new Map())

    const driftRoom: RoomInfo = {
      id: DEFAULT_DRIFT_ROOM_ID,
      name: 'Drift & Slalom Çevrimiçi Arenası',
      mode: 'DRIFT',
      map: 'DRIFT_TRACK',
      maxPlayers: 16,
      currentPlayers: 0,
      players: [],
      hostId: 'system',
      createdAt: Date.now(),
      driftState: OnlineDriftState.LOBBY,
      driftSessionDuration: 60,
    }
    this.rooms.set(DEFAULT_DRIFT_ROOM_ID, driftRoom)
    this.playerStatesByRoom.set(DEFAULT_DRIFT_ROOM_ID, new Map())
  }

  /**
   * Generate an uppercase 4-character room code (e.g. A7X9)
   */
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  /**
   * Create a new multiplayer room.
   */
  public createRoom(hostPlayer: PlayerInfo, options: CreateRoomRequest): RoomInfo {
    const roomId = `room_${Math.random().toString(36).substring(2, 8)}`
    const roomCode = (options.roomCode && options.roomCode.trim().toUpperCase()) || this.generateRoomCode()
    const roomName = (options.name && options.name.trim()) || `Oda #${roomCode}`

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
      roomCode,
      isPrivate: !!options.isPrivate,
    }

    this.rooms.set(roomId, room)
    this.playerStatesByRoom.set(roomId, new Map())
    return room
  }

  public getRoom(roomId: string): RoomInfo | undefined {
    return this.rooms.get(roomId)
  }

  public findRoomByCodeOrId(identifier: string): RoomInfo | undefined {
    const clean = identifier.trim()
    const byId = this.rooms.get(clean)
    if (byId) return byId

    const upper = clean.toUpperCase()
    for (const room of this.rooms.values()) {
      if (room.roomCode && room.roomCode.toUpperCase() === upper) {
        return room
      }
    }
    return undefined
  }

  public findQuickJoinRoom(preferredMode?: string): RoomInfo {
    const candidates = Array.from(this.rooms.values()).filter(
      r => !r.isPrivate && r.currentPlayers < r.maxPlayers
    )

    if (preferredMode) {
      const modeMatches = candidates.filter(r => r.mode === preferredMode)
      if (modeMatches.length > 0) {
        // Prioritize rooms with other players
        modeMatches.sort((a, b) => b.currentPlayers - a.currentPlayers)
        return modeMatches[0]
      }
    } else {
      // General quick join: prioritize rooms with active players
      const withPlayers = candidates.filter(r => r.currentPlayers > 0)
      if (withPlayers.length > 0) {
        withPlayers.sort((a, b) => b.currentPlayers - a.currentPlayers)
        return withPlayers[0]
      }
      if (candidates.length > 0) {
        return candidates[0]
      }
    }

    // Fallback to default rooms
    if (preferredMode === 'RACE') {
      return this.rooms.get(DEFAULT_RACE_ROOM_ID)!
    }
    if (preferredMode === 'DRIFT') {
      return this.rooms.get(DEFAULT_DRIFT_ROOM_ID)!
    }
    return this.rooms.get(DEFAULT_GLOBAL_ROOM_ID)!
  }

  public getAllRooms(): RoomInfo[] {
    return Array.from(this.rooms.values()).filter(r => !r.isPrivate)
  }

  public getRoomCount(): number {
    return this.rooms.size
  }

  /**
   * Join an existing room (by roomId or roomCode).
   */
  public joinRoom(identifier: string, player: PlayerInfo): { success: boolean; error?: string; room?: RoomInfo; player?: PlayerInfo } {
    const room = this.findRoomByCodeOrId(identifier)
    if (!room) {
      return { success: false, error: 'Oda bulunamadı' }
    }

    if (room.players.length >= room.maxPlayers) {
      return { success: false, error: 'Oda dolu' }
    }

    const roomId = room.id
    const existingIndex = room.players.findIndex(p => p.id === player.id)
    if (existingIndex !== -1) {
      const merged = { ...room.players[existingIndex], ...player }
      room.players[existingIndex] = merged
      return { success: true, room, player: merged }
    }

    const spawnIndex = room.players.length % 4
    const gridIndex = room.players.length % 8
    const isHost = room.players.length === 0 && room.id !== DEFAULT_GLOBAL_ROOM_ID && room.id !== DEFAULT_RACE_ROOM_ID && room.id !== DEFAULT_DRIFT_ROOM_ID
    const updatedPlayer: PlayerInfo = { ...player, isHost, spawnIndex, gridIndex, isReady: false }
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
      if (roomId === DEFAULT_GLOBAL_ROOM_ID || roomId === DEFAULT_RACE_ROOM_ID || roomId === DEFAULT_DRIFT_ROOM_ID) {
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

    const room = this.rooms.get(state.roomId)

    // 1. Playable World Bounds & Out-of-Bounds Detection (Phase 19)
    // If car falls below road level (y < -5.0) or exceeds map boundaries, trigger authoritative recovery
    if (
      validatedPos[1] < -5.0 ||
      validatedPos[1] > 200 ||
      Math.abs(validatedPos[0]) > 1000 ||
      Math.abs(validatedPos[2]) > 1000
    ) {
      // Authoritative fall recovery position based on mode
      if (room?.mode === 'RACE') {
        validatedPos = [2.5, 0.45, 570]
        validatedRot = [0, 0, 0, 1]
      } else if (room?.mode === 'DRIFT') {
        validatedPos = [0, 0.45, -600]
        validatedRot = [0, 0, 0, 1]
      } else {
        validatedPos = [0, 0.45, -25]
        validatedRot = [0, 0, 0, 1]
      }
      validatedVel = [0, 0, 0]
      needsCorrection = true
      correctionReason = 'OUT_OF_BOUNDS_FALL'
    } else if (state.isRespawn) {
      // 2. Mode-Aware Respawn Validation (Phase 19)
      let isLegal = true
      if (room?.mode === 'RACE') {
        const distFromTrack = Math.hypot(validatedPos[0], validatedPos[2] - 600)
        if (distFromTrack > 300 || validatedPos[1] < -0.5 || validatedPos[1] > 15) {
          isLegal = false
        }
      } else if (room?.mode === 'DRIFT') {
        const distFromDrift = Math.hypot(validatedPos[0], validatedPos[2] - (-600))
        if (distFromDrift > 250 || validatedPos[1] < -0.5 || validatedPos[1] > 15) {
          isLegal = false
        }
      } else {
        if (Math.abs(validatedPos[0]) > 250 || Math.abs(validatedPos[2]) > 250 || validatedPos[1] < -0.5 || validatedPos[1] > 15) {
          isLegal = false
        }
      }

      if (isLegal) {
        validatedVel = [0, 0, 0]
        needsCorrection = false
        correctionReason = undefined
      } else {
        validatedPos = room?.mode === 'RACE' ? [2.5, 0.45, 570] : room?.mode === 'DRIFT' ? [0, 0.45, -600] : [0, 0.45, -25]
        validatedRot = [0, 0, 0, 1]
        validatedVel = [0, 0, 0]
        needsCorrection = true
        correctionReason = 'ILLEGAL_RESPAWN_POSITION'
      }
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
