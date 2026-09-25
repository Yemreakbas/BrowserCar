import { io, type Socket } from 'socket.io-client'
import { DEFAULT_SERVER_URL, SOCKET_EVENTS } from '../../shared/src/constants.ts'
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  PlayerInitPayload,
  RoomInfo,
  RoomJoinedPayload,
  PlayerJoinedRoomPayload,
  PlayerLeftRoomPayload,
  ServerErrorPayload,
  PlayerStateMessage,
  RoomSnapshotPayload,
  ReconcilePayload,
  RaceRoomUpdatePayload,
  RaceStartCountdownPayload,
  RaceStartedPayload,
  RaceProgressPayload,
  RaceParticipantResult,
  RaceResultsPayload,
  RaceCheckpointPassRequest,
  DriftRoomUpdatePayload,
  DriftStartCountdownPayload,
  DriftStartedPayload,
  DriftScoreSubmission,
  DriftLeaderboardPayload,
  DriftSessionFinishedPayload,
} from '../../shared/src/messages.ts'

export type NetworkStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class NetworkManager {
  private socket: Socket | null = null
  private serverUrl: string = DEFAULT_SERVER_URL

  private status: NetworkStatus = 'disconnected'
  private localPlayerId: string | null = null
  private localPlayerName: string = ''
  private currentRoom: RoomInfo | null = null
  private availableRooms: RoomInfo[] = []

  // Sequence tracking & client prediction history (Phase 14)
  private sequenceNumber: number = 0
  private pendingStates: Array<{
    sequence: number
    position: [number, number, number]
    rotation: [number, number, number, number]
    timestamp: number
  }> = []

  // Ping tracking (Phase 15)
  private currentPing: number = 0
  private pingTimer: number | null = null

  // Event Listeners
  private statusListeners = new Set<(status: NetworkStatus, playerId?: string) => void>()
  private roomsListeners = new Set<(rooms: RoomInfo[]) => void>()
  private roomJoinedListeners = new Set<(payload: RoomJoinedPayload) => void>()
  private roomLeftListeners = new Set<(payload: { roomId: string; playerId: string }) => void>()
  private playerJoinedListeners = new Set<(payload: PlayerJoinedRoomPayload) => void>()
  private playerLeftListeners = new Set<(payload: PlayerLeftRoomPayload) => void>()
  private errorListeners = new Set<(err: ServerErrorPayload) => void>()
  private playerStateListeners = new Set<(state: PlayerStateMessage) => void>()
  private roomSnapshotListeners = new Set<(snapshot: RoomSnapshotPayload) => void>()
  private reconcileListeners = new Set<(payload: ReconcilePayload) => void>()

  // Race Event Listeners (Phase 16)
  private raceRoomUpdateListeners = new Set<(payload: RaceRoomUpdatePayload) => void>()
  private raceCountdownListeners = new Set<(payload: RaceStartCountdownPayload) => void>()
  private raceStartedListeners = new Set<(payload: RaceStartedPayload) => void>()
  private raceProgressListeners = new Set<(payload: RaceProgressPayload) => void>()
  private racePlayerFinishedListeners = new Set<(result: RaceParticipantResult) => void>()
  private raceResultsListeners = new Set<(payload: RaceResultsPayload) => void>()
  private raceRematchListeners = new Set<() => void>()

  // Drift Event Listeners (Phase 17)
  private driftRoomUpdateListeners = new Set<(payload: DriftRoomUpdatePayload) => void>()
  private driftCountdownListeners = new Set<(payload: DriftStartCountdownPayload) => void>()
  private driftStartedListeners = new Set<(payload: DriftStartedPayload) => void>()
  private driftLeaderboardListeners = new Set<(payload: DriftLeaderboardPayload) => void>()
  private driftSessionFinishedListeners = new Set<(payload: DriftSessionFinishedPayload) => void>()
  private driftRematchListeners = new Set<() => void>()

  constructor(serverUrl: string = DEFAULT_SERVER_URL) {
    this.serverUrl = serverUrl
  }

  public connect(url?: string): void {
    if (url) this.serverUrl = url
    if (this.socket && this.socket.connected) return

    this.setStatus('connecting')

    try {
      this.socket = io(this.serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 5000,
      })

      this.setupSocketHandlers()
    } catch (err) {
      console.warn('[NetworkManager] Connection attempt error:', err)
      this.setStatus('error')
    }
  }

  private startPingLoop(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer)
    this.pingTimer = window.setInterval(() => {
      if (this.socket && this.socket.connected) {
        const start = performance.now()
        this.socket.emit('player:ping', start, () => {
          this.currentPing = Math.round(performance.now() - start)
        })
      }
    }, 2500)
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return

    this.socket.on(SOCKET_EVENTS.CONNECT, () => {
      console.log(`[NetworkManager] Connected to server at ${this.serverUrl}`)
      this.startPingLoop()
    })

    this.socket.on(SOCKET_EVENTS.DISCONNECT, reason => {
      console.log(`[NetworkManager] Disconnected from server: ${reason}`)
      if (this.pingTimer) {
        window.clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      this.currentRoom = null
      this.setStatus('disconnected')
    })

    this.socket.on(SOCKET_EVENTS.PLAYER_INIT, (payload: PlayerInitPayload) => {
      this.localPlayerId = payload.playerId
      console.log(`[NetworkManager] Initialized as Player ID: ${this.localPlayerId}`)
      this.setStatus('connected', this.localPlayerId)
    })

    this.socket.on(SOCKET_EVENTS.ROOM_LIST_RESPONSE, (rooms: RoomInfo[]) => {
      this.availableRooms = rooms
      for (const listener of this.roomsListeners) {
        listener(rooms)
      }
    })

    this.socket.on(SOCKET_EVENTS.ROOM_JOINED, (payload: RoomJoinedPayload) => {
      this.currentRoom = payload.room
      console.log(`[NetworkManager] Joined room: ${payload.room.name} (${payload.room.id})`)
      for (const listener of this.roomJoinedListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.ROOM_LEFT, (payload: { roomId: string; playerId: string }) => {
      if (this.currentRoom && this.currentRoom.id === payload.roomId) {
        this.currentRoom = null
      }
      for (const listener of this.roomLeftListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.PLAYER_JOINED_ROOM, (payload: PlayerJoinedRoomPayload) => {
      if (this.currentRoom && this.currentRoom.id === payload.roomId) {
        this.currentRoom = payload.room
      }
      for (const listener of this.playerJoinedListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.PLAYER_LEFT_ROOM, (payload: PlayerLeftRoomPayload) => {
      if (this.currentRoom && this.currentRoom.id === payload.roomId) {
        this.currentRoom = payload.room
      }
      for (const listener of this.playerLeftListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.PLAYER_STATE, (state: PlayerStateMessage) => {
      for (const listener of this.playerStateListeners) {
        listener(state)
      }
    })

    this.socket.on(SOCKET_EVENTS.ROOM_SNAPSHOT, (snapshot: RoomSnapshotPayload) => {
      for (const listener of this.roomSnapshotListeners) {
        listener(snapshot)
      }
    })

    this.socket.on(SOCKET_EVENTS.SERVER_RECONCILE, (payload: ReconcilePayload) => {
      this.pendingStates = this.pendingStates.filter(s => s.sequence > payload.lastProcessedSequence)
      for (const listener of this.reconcileListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.SERVER_ERROR, (err: ServerErrorPayload) => {
      console.warn(`[NetworkManager] Server error [${err.code}]:`, err.message)
      for (const listener of this.errorListeners) {
        listener(err)
      }
    })

    this.socket.on(SOCKET_EVENTS.RACE_ROOM_UPDATE, (payload: RaceRoomUpdatePayload) => {
      if (this.currentRoom && this.currentRoom.id === payload.roomId) {
        this.currentRoom.raceState = payload.raceState
        this.currentRoom.players = payload.players
        this.currentRoom.countdownRemaining = payload.countdownRemaining
        this.currentRoom.raceStartTime = payload.startTime
      }
      for (const listener of this.raceRoomUpdateListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.RACE_START_COUNTDOWN, (payload: RaceStartCountdownPayload) => {
      for (const listener of this.raceCountdownListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.RACE_STARTED, (payload: RaceStartedPayload) => {
      for (const listener of this.raceStartedListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.RACE_PLAYER_PROGRESS, (payload: RaceProgressPayload) => {
      for (const listener of this.raceProgressListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.RACE_PLAYER_FINISHED, (result: RaceParticipantResult) => {
      for (const listener of this.racePlayerFinishedListeners) {
        listener(result)
      }
    })

    this.socket.on(SOCKET_EVENTS.RACE_RESULTS, (payload: RaceResultsPayload) => {
      for (const listener of this.raceResultsListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.RACE_REMATCH, () => {
      for (const listener of this.raceRematchListeners) {
        listener()
      }
    })

    // Drift Socket Event Handlers (Phase 17)
    this.socket.on(SOCKET_EVENTS.DRIFT_ROOM_UPDATE, (payload: DriftRoomUpdatePayload) => {
      for (const listener of this.driftRoomUpdateListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.DRIFT_START_COUNTDOWN, (payload: DriftStartCountdownPayload) => {
      for (const listener of this.driftCountdownListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.DRIFT_STARTED, (payload: DriftStartedPayload) => {
      for (const listener of this.driftStartedListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.DRIFT_LEADERBOARD_UPDATE, (payload: DriftLeaderboardPayload) => {
      for (const listener of this.driftLeaderboardListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.DRIFT_SESSION_FINISHED, (payload: DriftSessionFinishedPayload) => {
      for (const listener of this.driftSessionFinishedListeners) {
        listener(payload)
      }
    })

    this.socket.on(SOCKET_EVENTS.DRIFT_REMATCH, () => {
      for (const listener of this.driftRematchListeners) {
        listener()
      }
    })

    this.socket.on('connect_error', err => {
      console.warn('[NetworkManager] Connect error:', err.message)
      this.setStatus('error')
    })
  }

  public sendPlayerState(data: {
    position: [number, number, number]
    rotation: [number, number, number, number]
    velocity: [number, number, number]
    speed: number
    steering: number
    isBraking: boolean
    isDrifting: boolean
    isRespawn?: boolean
    inputs?: {
      forward: boolean
      backward: boolean
      left: boolean
      right: boolean
      handbrake: boolean
    }
  }): void {
    if (!this.socket || !this.socket.connected || !this.localPlayerId || !this.currentRoom) return

    this.sequenceNumber++

    const message: PlayerStateMessage = {
      playerId: this.localPlayerId,
      playerName: this.localPlayerName,
      roomId: this.currentRoom.id,
      position: data.position,
      rotation: data.rotation,
      velocity: data.velocity,
      speed: data.speed,
      steering: data.steering,
      isBraking: data.isBraking,
      isDrifting: data.isDrifting,
      sequence: this.sequenceNumber,
      isRespawn: data.isRespawn,
      inputs: data.inputs,
      timestamp: Date.now(),
    }

    this.pendingStates.push({
      sequence: this.sequenceNumber,
      position: data.position,
      rotation: data.rotation,
      timestamp: message.timestamp,
    })
    if (this.pendingStates.length > 60) this.pendingStates.shift()

    this.socket.emit(SOCKET_EVENTS.PLAYER_STATE, message)
  }

  /**
   * Broadcast an explicit player respawn / spawn cycle event without displacement penalty.
   */
  public sendRespawn(
    position: [number, number, number],
    rotation: [number, number, number, number]
  ): void {
    this.sendPlayerState({
      position,
      rotation,
      velocity: [0, 0, 0],
      speed: 0,
      steering: 0,
      isBraking: false,
      isDrifting: false,
      isRespawn: true,
      inputs: {
        forward: false,
        backward: false,
        left: false,
        right: false,
        handbrake: false,
      },
    })
  }

  public getPing(): number {
    return this.currentPing
  }

  public createRoom(options: { name: string; mode: string; map: string; maxPlayers?: number; playerName?: string }): Promise<RoomInfo> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        return reject(new Error('Sunucuya bağlı değil'))
      }

      const req: CreateRoomRequest = {
        name: options.name,
        mode: options.mode,
        map: options.map,
        maxPlayers: options.maxPlayers,
        playerName: options.playerName || this.localPlayerName,
      }

      this.socket.emit(SOCKET_EVENTS.ROOM_CREATE, req, (res: { success: boolean; room?: RoomInfo; error?: string }) => {
        if (res && res.success && res.room) {
          this.currentRoom = res.room
          resolve(res.room)
        } else {
          reject(new Error(res?.error || 'Oda oluşturulamadı'))
        }
      })
    })
  }

  public joinRoom(roomId: string, playerName?: string): Promise<RoomInfo> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        return reject(new Error('Sunucuya bağlı değil'))
      }

      const req: JoinRoomRequest = {
        roomId,
        playerName: playerName || this.localPlayerName,
      }

      this.socket.emit(SOCKET_EVENTS.ROOM_JOIN, req, (res: { success: boolean; room?: RoomInfo; error?: string }) => {
        if (res && res.success && res.room) {
          this.currentRoom = res.room
          resolve(res.room)
        } else {
          reject(new Error(res?.error || 'Odaya katılınamadı'))
        }
      })
    })
  }

  public leaveRoom(): Promise<void> {
    return new Promise(resolve => {
      if (!this.socket || !this.socket.connected || !this.currentRoom) {
        this.currentRoom = null
        return resolve()
      }

      const req: LeaveRoomRequest = { roomId: this.currentRoom.id }
      this.socket.emit(SOCKET_EVENTS.ROOM_LEAVE, req, () => {
        this.currentRoom = null
        resolve()
      })
    })
  }

  public refreshRooms(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit(SOCKET_EVENTS.ROOM_LIST)
    }
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.currentRoom = null
    this.setStatus('disconnected')
  }

  private setStatus(status: NetworkStatus, playerId?: string): void {
    this.status = status
    for (const listener of this.statusListeners) {
      listener(status, playerId || this.localPlayerId || undefined)
    }
  }

  // Getters
  public getStatus(): NetworkStatus {
    return this.status
  }

  public isConnected(): boolean {
    return this.status === 'connected' && !!this.localPlayerId
  }

  public getPlayerId(): string | null {
    return this.localPlayerId
  }

  public getCurrentRoom(): RoomInfo | null {
    return this.currentRoom
  }

  public getAvailableRooms(): RoomInfo[] {
    return this.availableRooms
  }

  public setPlayerName(name: string): void {
    this.localPlayerName = name
  }

  public getPlayerName(): string {
    return this.localPlayerName
  }

  // Subscriptions
  public onStatusChange(callback: (status: NetworkStatus, playerId?: string) => void): () => void {
    this.statusListeners.add(callback)
    callback(this.status, this.localPlayerId || undefined)
    return () => this.statusListeners.delete(callback)
  }

  public onRoomsUpdated(callback: (rooms: RoomInfo[]) => void): () => void {
    this.roomsListeners.add(callback)
    callback(this.availableRooms)
    return () => this.roomsListeners.delete(callback)
  }

  public onRoomJoined(callback: (payload: RoomJoinedPayload) => void): () => void {
    this.roomJoinedListeners.add(callback)
    return () => this.roomJoinedListeners.delete(callback)
  }

  public onRoomLeft(callback: (payload: { roomId: string; playerId: string }) => void): () => void {
    this.roomLeftListeners.add(callback)
    return () => this.roomLeftListeners.delete(callback)
  }

  public onPlayerJoinedRoom(callback: (payload: PlayerJoinedRoomPayload) => void): () => void {
    this.playerJoinedListeners.add(callback)
    return () => this.playerJoinedListeners.delete(callback)
  }

  public onPlayerLeftRoom(callback: (payload: PlayerLeftRoomPayload) => void): () => void {
    this.playerLeftListeners.add(callback)
    return () => this.playerLeftListeners.delete(callback)
  }

  public onError(callback: (err: ServerErrorPayload) => void): () => void {
    this.errorListeners.add(callback)
    return () => this.errorListeners.delete(callback)
  }

  public onPlayerState(callback: (state: PlayerStateMessage) => void): () => void {
    this.playerStateListeners.add(callback)
    return () => this.playerStateListeners.delete(callback)
  }

  public onRoomSnapshot(callback: (snapshot: RoomSnapshotPayload) => void): () => void {
    this.roomSnapshotListeners.add(callback)
    return () => this.roomSnapshotListeners.delete(callback)
  }

  public onReconcile(callback: (payload: ReconcilePayload) => void): () => void {
    this.reconcileListeners.add(callback)
    return () => this.reconcileListeners.delete(callback)
  }

  // --- ONLINE RACE METHODS & SUBSCRIPTIONS (PHASE 16) ---

  public sendReadyToggle(ready: boolean): void {
    if (!this.socket || !this.socket.connected) return
    this.socket.emit(SOCKET_EVENTS.RACE_READY_TOGGLE, ready)
  }

  public sendCheckpointPass(checkpointIndex: number, lap: number, position: [number, number, number]): void {
    if (!this.socket || !this.socket.connected || !this.currentRoom) return
    const request: RaceCheckpointPassRequest = {
      roomId: this.currentRoom.id,
      checkpointIndex,
      lap,
      timestamp: Date.now(),
      position,
    }
    this.socket.emit(SOCKET_EVENTS.RACE_CHECKPOINT_PASS, request)
  }

  public sendRematch(): void {
    if (!this.socket || !this.socket.connected) return
    this.socket.emit(SOCKET_EVENTS.RACE_REMATCH)
  }

  public onRaceRoomUpdate(callback: (payload: RaceRoomUpdatePayload) => void): () => void {
    this.raceRoomUpdateListeners.add(callback)
    return () => this.raceRoomUpdateListeners.delete(callback)
  }

  public onRaceCountdown(callback: (payload: RaceStartCountdownPayload) => void): () => void {
    this.raceCountdownListeners.add(callback)
    return () => this.raceCountdownListeners.delete(callback)
  }

  public onRaceStarted(callback: (payload: RaceStartedPayload) => void): () => void {
    this.raceStartedListeners.add(callback)
    return () => this.raceStartedListeners.delete(callback)
  }

  public onRaceProgress(callback: (payload: RaceProgressPayload) => void): () => void {
    this.raceProgressListeners.add(callback)
    return () => this.raceProgressListeners.delete(callback)
  }

  public onRacePlayerFinished(callback: (result: RaceParticipantResult) => void): () => void {
    this.racePlayerFinishedListeners.add(callback)
    return () => this.racePlayerFinishedListeners.delete(callback)
  }

  public onRaceResults(callback: (payload: RaceResultsPayload) => void): () => void {
    this.raceResultsListeners.add(callback)
    return () => this.raceResultsListeners.delete(callback)
  }

  public onRaceRematch(callback: () => void): () => void {
    this.raceRematchListeners.add(callback)
    return () => this.raceRematchListeners.delete(callback)
  }

  // --- ONLINE DRIFT METHODS & SUBSCRIPTIONS (PHASE 17) ---

  public sendDriftReadyToggle(): void {
    if (!this.socket || !this.socket.connected) return
    this.socket.emit(SOCKET_EVENTS.DRIFT_READY_TOGGLE)
  }

  public sendDriftScore(data: DriftScoreSubmission): void {
    if (!this.socket || !this.socket.connected) return
    this.socket.emit(SOCKET_EVENTS.DRIFT_SCORE_SUBMISSION, data)
  }

  public sendDriftRematch(): void {
    if (!this.socket || !this.socket.connected) return
    this.socket.emit(SOCKET_EVENTS.DRIFT_REMATCH)
  }

  public onDriftRoomUpdate(callback: (payload: DriftRoomUpdatePayload) => void): () => void {
    this.driftRoomUpdateListeners.add(callback)
    return () => this.driftRoomUpdateListeners.delete(callback)
  }

  public onDriftCountdown(callback: (payload: DriftStartCountdownPayload) => void): () => void {
    this.driftCountdownListeners.add(callback)
    return () => this.driftCountdownListeners.delete(callback)
  }

  public onDriftStarted(callback: (payload: DriftStartedPayload) => void): () => void {
    this.driftStartedListeners.add(callback)
    return () => this.driftStartedListeners.delete(callback)
  }

  public onDriftLeaderboard(callback: (payload: DriftLeaderboardPayload) => void): () => void {
    this.driftLeaderboardListeners.add(callback)
    return () => this.driftLeaderboardListeners.delete(callback)
  }

  public onDriftSessionFinished(callback: (payload: DriftSessionFinishedPayload) => void): () => void {
    this.driftSessionFinishedListeners.add(callback)
    return () => this.driftSessionFinishedListeners.delete(callback)
  }

  public onDriftRematch(callback: () => void): () => void {
    this.driftRematchListeners.add(callback)
    return () => this.driftRematchListeners.delete(callback)
  }
}
