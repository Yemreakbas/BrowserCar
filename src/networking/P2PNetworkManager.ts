import type {
  RoomInfo,
  RoomJoinedPayload,
  PlayerJoinedRoomPayload,
  PlayerLeftRoomPayload,
  PlayerStateMessage,
  RoomSnapshotPayload,
  RaceRoomUpdatePayload,
  RaceStartCountdownPayload,
  RaceStartedPayload,
  RaceProgressPayload,
  RaceParticipantResult,
  RaceResultsPayload,
  DriftRoomUpdatePayload,
  DriftStartCountdownPayload,
  DriftStartedPayload,
  DriftScoreSubmission,
  DriftLeaderboardPayload,
  DriftSessionFinishedPayload,
} from '../../shared/src/messages.ts'
import { OnlineRaceState, OnlineDriftState } from '../../shared/src/constants.ts'
import { PlayerProfileManager } from '../profile/PlayerProfile.ts'

export type NetworkStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface P2PPeerMessage {
  type: string
  payload?: any
  senderId?: string
}

declare const Peer: any

/**
 * WebRTC P2P Multiplayer Network Manager powered by PeerJS.
 * Fully static, zero external Node.js server required.
 * Perfect for Cloudflare Pages and static portal embedding.
 */
export class P2PNetworkManager {
  private peer: any = null
  private status: NetworkStatus = 'disconnected'
  private isHost: boolean = false
  private roomCode: string | null = null
  private myPlayerId: string | null = null
  private myPlayerName: string = 'Sürücü'

  // Host: connected guest connections map (playerId -> DataConnection)
  private guestConnections: Map<string, any> = new Map()
  // Guest: connection to host
  private hostConnection: any = null

  // Active Room State (managed authoritatively by Host or mirrored by Guest)
  private currentRoom: RoomInfo | null = null

  // Callback listeners
  private statusListeners: Array<(status: NetworkStatus, playerId?: string) => void> = []
  private roomJoinedListeners: Array<(payload: RoomJoinedPayload) => void> = []
  private playerJoinedListeners: Array<(payload: PlayerJoinedRoomPayload) => void> = []
  private playerLeftListeners: Array<(payload: PlayerLeftRoomPayload) => void> = []
  private roomLeftListeners: Array<() => void> = []
  private playerStateListeners: Array<(state: PlayerStateMessage) => void> = []
  private roomSnapshotListeners: Array<(snapshot: RoomSnapshotPayload) => void> = []
  private errorListeners: Array<(err: { message: string }) => void> = []

  // Race listeners
  private raceRoomUpdateListeners: Array<(payload: RaceRoomUpdatePayload) => void> = []
  private raceCountdownListeners: Array<(payload: RaceStartCountdownPayload) => void> = []
  private raceStartedListeners: Array<(payload: RaceStartedPayload) => void> = []
  private raceProgressListeners: Array<(payload: RaceProgressPayload) => void> = []
  private racePlayerFinishedListeners: Array<(result: RaceParticipantResult) => void> = []
  private raceResultsListeners: Array<(payload: RaceResultsPayload) => void> = []
  private raceRematchListeners: Array<() => void> = []

  // Drift listeners
  private driftRoomUpdateListeners: Array<(payload: DriftRoomUpdatePayload) => void> = []
  private driftCountdownListeners: Array<(payload: DriftStartCountdownPayload) => void> = []
  private driftStartedListeners: Array<(payload: DriftStartedPayload) => void> = []
  private driftLeaderboardListeners: Array<(payload: DriftLeaderboardPayload) => void> = []
  private driftSessionFinishedListeners: Array<(payload: DriftSessionFinishedPayload) => void> = []
  private driftRematchListeners: Array<() => void> = []

  // Broadcast ticker on Host
  private broadcastInterval: any = null
  private remotePlayerStates: Map<string, PlayerStateMessage> = new Map()

  constructor() {
    if (typeof window !== 'undefined') {
      const profile = PlayerProfileManager.getInstance().getProfile()
      this.myPlayerName = profile.displayName || `Racer_${Math.floor(100 + Math.random() * 900)}`
    }
  }

  public isConnected(): boolean {
    return this.status === 'connected'
  }

  public getPlayerId(): string | null {
    return this.myPlayerId
  }

  public getPlayerName(): string {
    return this.myPlayerName
  }

  public setPlayerName(name: string): void {
    this.myPlayerName = name.trim() || 'Sürücü'
    if (this.currentRoom && this.myPlayerId) {
      const me = this.currentRoom.players.find((p) => p.id === this.myPlayerId)
      if (me) me.name = this.myPlayerName
      if (this.isHost) this.broadcastRoomUpdate()
    }
  }

  public getCurrentRoom(): RoomInfo | null {
    return this.currentRoom
  }

  public getServerUrl(): string {
    return 'WebRTC P2P (PeerJS Cloud)'
  }

  public getPing(): number {
    return 12 // Direct P2P latency
  }

  public getRoomCode(): string | null {
    return this.roomCode
  }

  private setStatus(newStatus: NetworkStatus, id?: string): void {
    this.status = newStatus
    this.statusListeners.forEach((fn) => fn(newStatus, id || this.myPlayerId || undefined))
  }

  /**
   * Helper: Ensure PeerJS is loaded from CDN window.Peer
   */
  private getPeerClass(): any {
    if (typeof window !== 'undefined' && (window as any).Peer) {
      return (window as any).Peer
    }
    throw new Error('PeerJS kütüphanesi henüz yüklenmedi. Lütfen internet bağlantınızı kontrol edin.')
  }

  /**
   * HOST: Creates a new P2P room with a clean 4-digit code (e.g. 7421)
   */
  public async createHostRoom(mode: 'CITY_FREE_ROAM' | 'RACE' | 'DRIFT' = 'CITY_FREE_ROAM'): Promise<string> {
    this.disconnect()
    this.setStatus('connecting')

    const PeerClass = this.getPeerClass()
    const code = Math.floor(1000 + Math.random() * 9000).toString()
    const hostPeerId = `bcar-p2p-${code}`

    return new Promise((resolve, reject) => {
      try {
        this.peer = new PeerClass(hostPeerId, {
          debug: 1,
        })
      } catch (err: any) {
        this.setStatus('error')
        reject(err)
        return
      }

      const timeout = setTimeout(() => {
        if (this.status !== 'connected') {
          this.setStatus('error')
          reject(new Error('Oda oluşturulurken zaman aşımı oluştu. Lütfen tekrar deneyin.'))
        }
      }, 10000)

      this.peer.on('open', (id: string) => {
        clearTimeout(timeout)
        this.isHost = true
        this.roomCode = code
        this.myPlayerId = id

        this.currentRoom = {
          id: `room_${code}`,
          roomCode: code,
          name: `${this.myPlayerName}'in Odası`,
          mode: mode,
          map: mode === 'RACE' ? 'RACE_TRACK' : mode === 'DRIFT' ? 'DRIFT_TRACK' : 'CITY',
          maxPlayers: 8,
          currentPlayers: 1,
          isPrivate: true,
          hostId: id,
          createdAt: Date.now(),
          raceState: OnlineRaceState.LOBBY,
          driftState: OnlineDriftState.LOBBY,
          countdownRemaining: 0,
          players: [
            {
              id,
              name: this.myPlayerName,
              isHost: true,
              isReady: false,
              gridIndex: 0,
              ping: 0,
              connectedAt: Date.now(),
            },
          ],
        }

        this.setStatus('connected', id)
        this.startHostBroadcast()

        this.roomJoinedListeners.forEach((fn) =>
          fn({
            room: this.currentRoom!,
            player: this.currentRoom!.players[0],
          })
        )

        resolve(code)
      })

      this.peer.on('connection', (conn: any) => {
        this.handleGuestConnection(conn)
      })

      this.peer.on('error', (err: any) => {
        clearTimeout(timeout)
        console.warn('[P2P Host] Peer error:', err)
        this.setStatus('error')
        this.errorListeners.forEach((fn) => fn({ message: err.message || 'P2P Bağlantı hatası' }))
        reject(err)
      })
    })
  }

  /**
   * GUEST: Connects to a Host's room using their 4-digit code
   */
  public async joinHostRoom(code: string): Promise<RoomInfo> {
    this.disconnect()
    this.setStatus('connecting')

    const cleanCode = code.trim().toUpperCase()
    const targetPeerId = `bcar-p2p-${cleanCode}`
    const PeerClass = this.getPeerClass()

    const clientPeerId = `bcar-cli-${Math.floor(10000 + Math.random() * 90000)}`

    return new Promise((resolve, reject) => {
      try {
        this.peer = new PeerClass(clientPeerId, { debug: 1 })
      } catch (err: any) {
        this.setStatus('error')
        reject(err)
        return
      }

      const timeout = setTimeout(() => {
        if (this.status !== 'connected') {
          this.setStatus('error')
          reject(new Error(`Oda (${cleanCode}) bulunamadı. Kodun doğruluğundan emin olun.`))
        }
      }, 12000)

      this.peer.on('open', (id: string) => {
        this.myPlayerId = id
        this.isHost = false
        this.roomCode = cleanCode

        // Connect directly to the Host
        const conn = this.peer.connect(targetPeerId, {
          reliable: true,
        })

        conn.on('open', () => {
          clearTimeout(timeout)
          this.hostConnection = conn
          this.setStatus('connected', id)

          // Send Join handshake to Host
          conn.send({
            type: 'PLAYER_JOIN',
            payload: {
              playerId: id,
              name: this.myPlayerName,
            },
          })
        })

        conn.on('data', (data: P2PPeerMessage) => {
          this.handleMessageFromHost(data, resolve)
        })

        conn.on('close', () => {
          console.warn('[P2P Guest] Connection to host closed')
          this.disconnect()
        })

        conn.on('error', (err: any) => {
          clearTimeout(timeout)
          console.warn('[P2P Guest] Host connection error:', err)
          this.setStatus('error')
          reject(err)
        })
      })

      this.peer.on('error', (err: any) => {
        clearTimeout(timeout)
        this.setStatus('error')
        reject(new Error(`Odaya bağlanılamadı: ${err.message || 'Host bulunamadı'}`))
      })
    })
  }

  /**
   * HOST: Handles incoming guest connection
   */
  private handleGuestConnection(conn: any): void {
    conn.on('data', (data: P2PPeerMessage) => {
      if (!this.currentRoom) return

      if (data.type === 'PLAYER_JOIN') {
        const guestId = data.payload.playerId || conn.peer
        const guestName = data.payload.name || `Racer_${this.guestConnections.size + 2}`
        const gridIndex = (this.currentRoom.players.length) % 8

        this.guestConnections.set(guestId, conn)

        const newPlayer = {
          id: guestId,
          name: guestName,
          isReady: false,
          gridIndex,
          ping: 15,
          connectedAt: Date.now(),
        }

        this.currentRoom.players.push(newPlayer)
        this.currentRoom.currentPlayers = this.currentRoom.players.length

        // Send Welcome response to Guest
        conn.send({
          type: 'ROOM_JOINED',
          payload: {
            room: this.currentRoom,
            player: newPlayer,
          },
        })

        // Notify existing players
        this.broadcast({
          type: 'PLAYER_JOINED_ROOM',
          payload: {
            roomId: this.currentRoom.id,
            room: this.currentRoom,
            player: newPlayer,
          },
        }, guestId)

        this.playerJoinedListeners.forEach((fn) =>
          fn({
            roomId: this.currentRoom!.id,
            room: this.currentRoom!,
            player: newPlayer,
          })
        )
      } else if (data.type === 'PLAYER_STATE') {
        const state = data.payload as PlayerStateMessage
        if (state && state.playerId) {
          this.remotePlayerStates.set(state.playerId, state)
          // Broadcast to other guests
          this.broadcast(data, state.playerId)
          this.playerStateListeners.forEach((fn) => fn(state))
        }
      } else if (data.type === 'PLAYER_READY') {
        const pId = data.payload.playerId
        const p = this.currentRoom.players.find((item) => item.id === pId)
        if (p) {
          p.isReady = !!data.payload.isReady
          this.broadcastRoomUpdate()
          this.checkStartRaceCountdown()
        }
      } else if (data.type === 'CHECKPOINT_PASS') {
        this.broadcast(data)
      } else if (data.type === 'PLAYER_FINISHED') {
        this.broadcast(data)
      } else if (data.type === 'DRIFT_SCORE') {
        this.broadcast(data)
      }
    })

    conn.on('close', () => {
      const guestId = conn.peer
      this.guestConnections.delete(guestId)
      if (this.currentRoom) {
        this.currentRoom.players = this.currentRoom.players.filter((p) => p.id !== guestId)
        this.currentRoom.currentPlayers = this.currentRoom.players.length
        this.broadcast({
          type: 'PLAYER_LEFT_ROOM',
          payload: {
            roomId: this.currentRoom.id,
            room: this.currentRoom,
            playerId: guestId,
          },
        })
        this.playerLeftListeners.forEach((fn) =>
          fn({
            roomId: this.currentRoom!.id,
            room: this.currentRoom!,
            playerId: guestId,
          })
        )
      }
    })
  }

  /**
   * GUEST: Handles messages from Host
   */
  private handleMessageFromHost(data: P2PPeerMessage, onJoinResolve?: (room: RoomInfo) => void): void {
    if (data.type === 'ROOM_JOINED') {
      this.currentRoom = data.payload.room
      if (onJoinResolve) onJoinResolve(this.currentRoom!)
      this.roomJoinedListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'PLAYER_JOINED_ROOM') {
      this.currentRoom = data.payload.room
      this.playerJoinedListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'PLAYER_LEFT_ROOM') {
      this.currentRoom = data.payload.room
      this.playerLeftListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'PLAYER_STATE') {
      this.playerStateListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'ROOM_SNAPSHOT') {
      this.roomSnapshotListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'RACE_ROOM_UPDATE') {
      this.currentRoom = data.payload
      this.raceRoomUpdateListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'RACE_COUNTDOWN') {
      this.raceCountdownListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'RACE_STARTED') {
      this.raceStartedListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'RACE_PROGRESS') {
      this.raceProgressListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'PLAYER_FINISHED') {
      this.racePlayerFinishedListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'RACE_RESULTS') {
      this.raceResultsListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'RACE_REMATCH') {
      this.raceRematchListeners.forEach((fn) => fn())
      this.driftRematchListeners.forEach((fn) => fn())
    } else if (data.type === 'DRIFT_ROOM_UPDATE') {
      this.driftRoomUpdateListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'DRIFT_COUNTDOWN') {
      this.driftCountdownListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'DRIFT_STARTED') {
      this.driftStartedListeners.forEach((fn) => fn(data.payload))
    } else if (data.type === 'DRIFT_LEADERBOARD') {
      this.driftLeaderboardListeners.forEach((fn) => fn(data.payload))
    }
  }

  /**
   * HOST: Broadcasts a message to all connected peers
   */
  private broadcast(msg: P2PPeerMessage, excludeId?: string): void {
    for (const [id, conn] of this.guestConnections.entries()) {
      if (id !== excludeId && conn.open) {
        conn.send(msg)
      }
    }
  }

  /**
   * HOST: Starts periodic state sync snapshot loop at 30 Hz
   */
  private startHostBroadcast(): void {
    if (this.broadcastInterval) clearInterval(this.broadcastInterval)
    this.broadcastInterval = setInterval(() => {
      if (!this.isHost || !this.currentRoom) return
      const states = Array.from(this.remotePlayerStates.values())
      if (states.length > 0) {
        this.broadcast({
          type: 'ROOM_SNAPSHOT',
          payload: {
            timestamp: Date.now(),
            states,
          },
        })
      }
    }, 33)
  }

  /**
   * HOST: Checks if all players are ready to start Grand Prix 3-2-1 countdown
   */
  private checkStartRaceCountdown(): void {
    if (!this.isHost || !this.currentRoom) return
    if (this.currentRoom.mode !== 'RACE') return
    if (this.currentRoom.raceState !== OnlineRaceState.LOBBY) return

    const allReady = this.currentRoom.players.every((p) => p.isReady)
    if (allReady && this.currentRoom.players.length >= 1) {
      this.startHostRaceCountdown()
    }
  }

  private startHostRaceCountdown(): void {
    if (!this.currentRoom) return
    this.currentRoom.raceState = OnlineRaceState.COUNTDOWN
    let count = 3

    const interval = setInterval(() => {
      if (!this.currentRoom) {
        clearInterval(interval)
        return
      }

      const countdownPayload: RaceStartCountdownPayload = {
        roomId: this.currentRoom.id,
        countdownSeconds: count,
        startsAt: Date.now() + 1000,
      }
      this.broadcast({
        type: 'RACE_COUNTDOWN',
        payload: countdownPayload,
      })
      this.raceCountdownListeners.forEach((fn) => fn(countdownPayload))

      count--
      if (count < 0) {
        clearInterval(interval)
        this.currentRoom.raceState = OnlineRaceState.RACING
        const startedPayload: RaceStartedPayload = {
          roomId: this.currentRoom.id,
          startedAt: Date.now(),
          totalLaps: 3,
        }
        this.broadcast({
          type: 'RACE_STARTED',
          payload: startedPayload,
        })
        this.raceStartedListeners.forEach((fn) => fn(startedPayload))
      }
    }, 1000)
  }

  private broadcastRoomUpdate(): void {
    if (!this.isHost || !this.currentRoom) return
    const msg = {
      type: this.currentRoom.mode === 'RACE' ? 'RACE_ROOM_UPDATE' : 'DRIFT_ROOM_UPDATE',
      payload: this.currentRoom,
    }
    this.broadcast(msg)
    if (this.currentRoom.mode === 'RACE') {
      this.raceRoomUpdateListeners.forEach((fn) => fn(this.currentRoom as any))
    }
  }

  /**
   * Streams local player telemetry (position, quaternion, speed, drift, etc.)
   */
  public sendPlayerState(
    arg0:
      | {
          position: [number, number, number]
          rotation: [number, number, number, number]
          velocity?: [number, number, number]
          speed: number
          steering?: number
          isBraking: boolean
          isDrifting: boolean
          isNitro?: boolean
          isRespawn?: boolean
          inputs?: any
        }
      | [number, number, number],
    arg1?: [number, number, number, number],
    arg2?: number,
    arg3?: boolean,
    arg4?: boolean,
    arg5?: number,
    arg6?: {
      isNitro?: boolean
      health?: number
      slipAngleDeg?: number
      lap?: number
      checkpoint?: number
      driftScore?: number
    }
  ): void {
    if (!this.myPlayerId || !this.isConnected()) return

    const roomId = this.currentRoom?.id || 'room_p2p'
    let msg: PlayerStateMessage

    if (Array.isArray(arg0)) {
      msg = {
        playerId: this.myPlayerId,
        roomId,
        sequence: Date.now(),
        timestamp: Date.now(),
        position: arg0,
        rotation: arg1 || [0, 0, 0, 1],
        velocity: [0, 0, 0],
        speed: arg2 || 0,
        steering: arg5 || 0,
        isDrifting: !!arg3,
        isBraking: !!arg4,
        isNitro: arg6?.isNitro,
      }
    } else {
      msg = {
        playerId: this.myPlayerId,
        roomId,
        sequence: Date.now(),
        timestamp: Date.now(),
        position: arg0.position,
        rotation: arg0.rotation,
        velocity: arg0.velocity || [0, 0, 0],
        speed: arg0.speed || 0,
        steering: arg0.steering || 0,
        isBraking: arg0.isBraking,
        isDrifting: arg0.isDrifting,
        isNitro: arg0.isNitro,
        inputs: arg0.inputs,
      }
    }

    if (this.isHost) {
      this.remotePlayerStates.set(this.myPlayerId, msg)
      this.broadcast({ type: 'PLAYER_STATE', payload: msg }, this.myPlayerId)
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({ type: 'PLAYER_STATE', payload: msg })
    }
  }

  public sendRespawn(pos: [number, number, number], rot: [number, number, number, number]): void {
    this.sendPlayerState(pos, rot, 0, false, false, 0)
  }

  public sendReady(isReady: boolean): void {
    if (!this.myPlayerId) return
    if (this.isHost && this.currentRoom) {
      const me = this.currentRoom.players.find((p) => p.id === this.myPlayerId)
      if (me) me.isReady = isReady
      this.broadcastRoomUpdate()
      this.checkStartRaceCountdown()
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({
        type: 'PLAYER_READY',
        payload: { playerId: this.myPlayerId, isReady },
      })
    }
  }

  public sendReadyToggle(isReady: boolean): void {
    this.sendReady(isReady)
  }

  public sendRematch(): void {
    if (this.isHost && this.currentRoom) {
      this.currentRoom.raceState = OnlineRaceState.LOBBY
      this.currentRoom.players.forEach((p) => (p.isReady = false))
      this.broadcast({ type: 'RACE_REMATCH' })
      this.broadcastRoomUpdate()
      this.raceRematchListeners.forEach((fn) => fn())
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({ type: 'RACE_REMATCH' })
    }
  }

  public sendCheckpointPass(checkpointIndexOrLap: number, lapOrCp: number, positionOrTime?: any): void {
    const payload = {
      playerId: this.myPlayerId,
      checkpointIndex: checkpointIndexOrLap,
      lap: lapOrCp,
      position: positionOrTime,
      timestamp: Date.now(),
    }
    if (this.isHost) {
      this.broadcast({ type: 'CHECKPOINT_PASS', payload })
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({ type: 'CHECKPOINT_PASS', payload })
    }
  }

  public sendDriftScore(
    submissionOrScore: DriftScoreSubmission | number,
    multiplier?: number,
    angle?: number
  ): void {
    let payload: DriftScoreSubmission
    if (typeof submissionOrScore === 'object') {
      payload = submissionOrScore
    } else {
      payload = {
        roomId: this.currentRoom?.id || 'room_drift',
        pointsDelta: submissionOrScore,
        comboMultiplier: multiplier || 1.0,
        slipAngleDeg: angle || 0,
        speedKmh: 0,
        duration: 0,
        zoneBonus: 1.0,
        timestamp: Date.now(),
      }
    }
    if (this.isHost) {
      this.broadcast({ type: 'DRIFT_SCORE', payload })
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send({ type: 'DRIFT_SCORE', payload })
    }
  }

  public sendDriftReadyToggle(): void {
    const me = this.currentRoom?.players.find((p) => p.id === this.myPlayerId)
    this.sendReadyToggle(!me?.isReady)
  }

  public sendPlayerReset(pos: [number, number, number], rot: [number, number, number, number], _reason?: string): void {
    this.sendRespawn(pos, rot)
  }

  public onReconcile(_fn: (payload: any) => void): () => void {
    return () => {}
  }

  public onDriftRematch(fn: () => void): () => void {
    this.driftRematchListeners.push(fn)
    return () => {
      this.driftRematchListeners = this.driftRematchListeners.filter((cb) => cb !== fn)
    }
  }

  public sendDriftRematch(): void {
    this.sendRematch()
  }

  public async createRoom(options: {
    name?: string
    mode?: 'CITY_FREE_ROAM' | 'RACE' | 'DRIFT' | string
    map?: string
    maxPlayers?: number
    playerName?: string
    isPrivate?: boolean
    roomCode?: string
  }): Promise<RoomInfo> {
    if (options.playerName) this.setPlayerName(options.playerName)
    const mode = (options.mode as any) || 'CITY_FREE_ROAM'
    await this.createHostRoom(mode)
    if (this.currentRoom && options.name) {
      this.currentRoom.name = options.name
    }
    return this.currentRoom!
  }

  public async joinRoom(roomIdOrCode: string, playerName?: string): Promise<RoomInfo> {
    if (playerName) this.setPlayerName(playerName)
    let code = roomIdOrCode.replace('room_', '').replace('bcar-p2p-', '').trim().toUpperCase()
    if (!code || code === 'CITY_FREE_ROAM' || code === 'DEFAULT_GLOBAL' || code === 'DEFAULT_CITY') {
      code = 'CITY'
    } else if (code === 'RACE' || code === 'DEFAULT_RACE') {
      code = 'RACE'
    } else if (code === 'DRIFT' || code === 'DEFAULT_DRIFT') {
      code = 'DRIFT'
    }
    try {
      return await this.joinHostRoom(code)
    } catch {
      await this.createHostRoom(
        (roomIdOrCode.includes('RACE')
          ? 'RACE'
          : roomIdOrCode.includes('DRIFT')
          ? 'DRIFT'
          : 'CITY_FREE_ROAM') as any
      )
      return this.currentRoom!
    }
  }

  public async joinRoomByCode(code: string, playerName?: string): Promise<RoomInfo> {
    if (playerName) this.setPlayerName(playerName)
    return this.joinHostRoom(code)
  }

  public async quickJoin(options: { mode: string; playerName?: string }): Promise<RoomInfo> {
    if (options.playerName) this.setPlayerName(options.playerName)
    const code = options.mode === 'RACE' ? 'RACE' : options.mode === 'DRIFT' ? 'DRIFT' : 'CITY'
    return this.joinRoom(code, options.playerName)
  }

  public getAvailableRooms(): RoomInfo[] {
    return this.currentRoom ? [this.currentRoom] : []
  }

  public onRoomsUpdated(callback: (rooms: RoomInfo[]) => void): () => void {
    callback(this.getAvailableRooms())
    return () => {}
  }

  public onLeaderboardUpdate(_callback: (payload: any) => void): () => void {
    return () => {}
  }

  public async fetchLeaderboards(): Promise<any> {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('bcar_leaderboards_v1') : null
    if (raw) {
      try {
        return JSON.parse(raw)
      } catch {}
    }
    return { fastest_lap: [], drift_score: [], race_wins: [] }
  }

  public async fetchCategoryLeaderboard(category: string): Promise<any> {
    const all = await this.fetchLeaderboards()
    return { category, entries: all[category] || [] }
  }

  public async submitLeaderboardRecord(request: any): Promise<any> {
    const all = await this.fetchLeaderboards()
    const cat = request.category || 'fastest_lap'
    if (!all[cat]) all[cat] = []
    all[cat].push({
      id: `rec_${Date.now()}`,
      playerName: request.playerName || this.myPlayerName,
      carId: request.carId || 'car_sports',
      value: request.value,
      timestamp: Date.now(),
    })
    all[cat].sort((a: any, b: any) => (cat === 'fastest_lap' ? a.value - b.value : b.value - a.value))
    all[cat] = all[cat].slice(0, 10)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bcar_leaderboards_v1', JSON.stringify(all))
    }
    return { success: true, rank: 1 }
  }

  public leaveRoom(): void {
    this.disconnect()
    this.roomLeftListeners.forEach((fn) => fn())
  }

  public disconnect(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval)
      this.broadcastInterval = null
    }

    if (this.hostConnection) {
      try {
        this.hostConnection.close()
      } catch {}
      this.hostConnection = null
    }

    for (const conn of this.guestConnections.values()) {
      try {
        conn.close()
      } catch {}
    }
    this.guestConnections.clear()

    if (this.peer) {
      try {
        this.peer.destroy()
      } catch {}
      this.peer = null
    }

    this.currentRoom = null
    this.isHost = false
    this.roomCode = null
    this.remotePlayerStates.clear()
    this.setStatus('disconnected')
  }

  public connect(): void {
    // In P2P mode, connect is invoked when creating or joining a room
  }

  public refreshRooms(): void {
    // In P2P serverless mode, rooms are discovered via 4-digit codes
  }

  // Listener subscriptions
  public onStatusChange(fn: (status: NetworkStatus, playerId?: string) => void): () => void {
    this.statusListeners.push(fn)
    return () => {
      this.statusListeners = this.statusListeners.filter((cb) => cb !== fn)
    }
  }

  public onRoomJoined(fn: (payload: RoomJoinedPayload) => void): () => void {
    this.roomJoinedListeners.push(fn)
    return () => {
      this.roomJoinedListeners = this.roomJoinedListeners.filter((cb) => cb !== fn)
    }
  }

  public onPlayerJoinedRoom(fn: (payload: PlayerJoinedRoomPayload) => void): () => void {
    this.playerJoinedListeners.push(fn)
    return () => {
      this.playerJoinedListeners = this.playerJoinedListeners.filter((cb) => cb !== fn)
    }
  }

  public onPlayerLeftRoom(fn: (payload: PlayerLeftRoomPayload) => void): () => void {
    this.playerLeftListeners.push(fn)
    return () => {
      this.playerLeftListeners = this.playerLeftListeners.filter((cb) => cb !== fn)
    }
  }

  public onRoomLeft(fn: () => void): () => void {
    this.roomLeftListeners.push(fn)
    return () => {
      this.roomLeftListeners = this.roomLeftListeners.filter((cb) => cb !== fn)
    }
  }

  public onPlayerState(fn: (state: PlayerStateMessage) => void): () => void {
    this.playerStateListeners.push(fn)
    return () => {
      this.playerStateListeners = this.playerStateListeners.filter((cb) => cb !== fn)
    }
  }

  public onRoomSnapshot(fn: (snapshot: RoomSnapshotPayload) => void): () => void {
    this.roomSnapshotListeners.push(fn)
    return () => {
      this.roomSnapshotListeners = this.roomSnapshotListeners.filter((cb) => cb !== fn)
    }
  }

  public onError(fn: (err: { message: string }) => void): () => void {
    this.errorListeners.push(fn)
    return () => {
      this.errorListeners = this.errorListeners.filter((cb) => cb !== fn)
    }
  }

  public onReconnectAttempt(_fn: (attempt: number) => void): () => void {
    return () => {}
  }

  public onRoomFallback(_fn: (payload: any) => void): () => void {
    return () => {}
  }

  public onRaceRoomUpdate(fn: (payload: RaceRoomUpdatePayload) => void): () => void {
    this.raceRoomUpdateListeners.push(fn)
    return () => {
      this.raceRoomUpdateListeners = this.raceRoomUpdateListeners.filter((cb) => cb !== fn)
    }
  }

  public onRaceCountdown(fn: (payload: RaceStartCountdownPayload) => void): () => void {
    this.raceCountdownListeners.push(fn)
    return () => {
      this.raceCountdownListeners = this.raceCountdownListeners.filter((cb) => cb !== fn)
    }
  }

  public onRaceStarted(fn: (payload: RaceStartedPayload) => void): () => void {
    this.raceStartedListeners.push(fn)
    return () => {
      this.raceStartedListeners = this.raceStartedListeners.filter((cb) => cb !== fn)
    }
  }

  public onRaceProgress(fn: (payload: RaceProgressPayload) => void): () => void {
    this.raceProgressListeners.push(fn)
    return () => {
      this.raceProgressListeners = this.raceProgressListeners.filter((cb) => cb !== fn)
    }
  }

  public onRacePlayerFinished(fn: (result: RaceParticipantResult) => void): () => void {
    this.racePlayerFinishedListeners.push(fn)
    return () => {
      this.racePlayerFinishedListeners = this.racePlayerFinishedListeners.filter((cb) => cb !== fn)
    }
  }

  public onRaceResults(fn: (payload: RaceResultsPayload) => void): () => void {
    this.raceResultsListeners.push(fn)
    return () => {
      this.raceResultsListeners = this.raceResultsListeners.filter((cb) => cb !== fn)
    }
  }

  public onRaceRematch(fn: () => void): () => void {
    this.raceRematchListeners.push(fn)
    return () => {
      this.raceRematchListeners = this.raceRematchListeners.filter((cb) => cb !== fn)
    }
  }

  public onDriftRoomUpdate(fn: (payload: DriftRoomUpdatePayload) => void): () => void {
    this.driftRoomUpdateListeners.push(fn)
    return () => {
      this.driftRoomUpdateListeners = this.driftRoomUpdateListeners.filter((cb) => cb !== fn)
    }
  }

  public onDriftCountdown(fn: (payload: DriftStartCountdownPayload) => void): () => void {
    this.driftCountdownListeners.push(fn)
    return () => {
      this.driftCountdownListeners = this.driftCountdownListeners.filter((cb) => cb !== fn)
    }
  }

  public onDriftStarted(fn: (payload: DriftStartedPayload) => void): () => void {
    this.driftStartedListeners.push(fn)
    return () => {
      this.driftStartedListeners = this.driftStartedListeners.filter((cb) => cb !== fn)
    }
  }

  public onDriftLeaderboard(fn: (payload: DriftLeaderboardPayload) => void): () => void {
    this.driftLeaderboardListeners.push(fn)
    return () => {
      this.driftLeaderboardListeners = this.driftLeaderboardListeners.filter((cb) => cb !== fn)
    }
  }

  public onDriftSessionFinished(fn: (payload: DriftSessionFinishedPayload) => void): () => void {
    this.driftSessionFinishedListeners.push(fn)
    return () => {
      this.driftSessionFinishedListeners = this.driftSessionFinishedListeners.filter((cb) => cb !== fn)
    }
  }
}
