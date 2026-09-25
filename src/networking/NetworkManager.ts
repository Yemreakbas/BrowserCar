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

  // Event Listeners
  private statusListeners = new Set<(status: NetworkStatus, playerId?: string) => void>()
  private roomsListeners = new Set<(rooms: RoomInfo[]) => void>()
  private roomJoinedListeners = new Set<(payload: RoomJoinedPayload) => void>()
  private roomLeftListeners = new Set<(payload: { roomId: string; playerId: string }) => void>()
  private playerJoinedListeners = new Set<(payload: PlayerJoinedRoomPayload) => void>()
  private playerLeftListeners = new Set<(payload: PlayerLeftRoomPayload) => void>()
  private errorListeners = new Set<(err: ServerErrorPayload) => void>()

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

  private setupSocketHandlers(): void {
    if (!this.socket) return

    this.socket.on(SOCKET_EVENTS.CONNECT, () => {
      console.log(`[NetworkManager] Connected to server at ${this.serverUrl}`)
      // Status will transition to 'connected' once PLAYER_INIT is received
    })

    this.socket.on(SOCKET_EVENTS.DISCONNECT, reason => {
      console.log(`[NetworkManager] Disconnected from server: ${reason}`)
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

    this.socket.on(SOCKET_EVENTS.SERVER_ERROR, (err: ServerErrorPayload) => {
      console.warn(`[NetworkManager] Server error [${err.code}]:`, err.message)
      for (const listener of this.errorListeners) {
        listener(err)
      }
    })

    this.socket.on('connect_error', err => {
      console.warn('[NetworkManager] Connect error:', err.message)
      this.setStatus('error')
    })
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
}
