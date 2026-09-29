import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_GLOBAL_ROOM_ID,
  DEFAULT_RACE_ROOM_ID,
  DEFAULT_DRIFT_ROOM_ID,
  SERVER_TICK_RATE,
  SERVER_TICK_INTERVAL_MS,
  SOCKET_EVENTS,
} from '../../shared/src/constants.ts'
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  PlayerInitPayload,
  RoomJoinedPayload,
  PlayerJoinedRoomPayload,
  PlayerLeftRoomPayload,
  PlayerStateMessage,
  RoomSnapshotPayload,
  ReconcilePayload,
  RaceCheckpointPassRequest,
  DriftScoreSubmission,
  QuickJoinRequest,
  PlayerResetRequest,
  PlayerResetResponse,
  AuthoritativePlayerState,
} from '../../shared/src/messages.ts'
import { PlayerManager } from './players/PlayerManager.ts'
import { RoomManager } from './rooms/RoomManager.ts'
import { OnlineRaceManager } from './race/OnlineRaceManager.ts'
import { OnlineDriftManager } from './drift/OnlineDriftManager.ts'
import { LeaderboardManager } from './leaderboard/LeaderboardManager.ts'
import { rateLimiter } from './security/RateLimiter.ts'
import { AntiCheatValidator } from './security/AntiCheat.ts'
import type {
  LeaderboardCategory,
  LeaderboardSubmitRequest,
} from '../../shared/src/messages.ts'

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT
const HOST = process.env.HOST || '0.0.0.0'
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const startTime = Date.now()
let currentServerTick = 0

const playerManager = new PlayerManager()
const roomManager = new RoomManager()
const leaderboardManager = new LeaderboardManager()

// 1. Create HTTP Server with Health & Status Endpoints
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health' || url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        serverTick: currentServerTick,
        tickRateHz: SERVER_TICK_RATE,
        activePlayers: playerManager.getPlayerCount(),
        activeRooms: roomManager.getRoomCount(),
        timestamp: Date.now(),
      })
    )
    return
  }

  // Leaderboard REST Endpoints (Phase 25)
  if (url.pathname === '/api/leaderboards') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(leaderboardManager.getAll(50)))
    return
  }

  if (url.pathname === '/api/leaderboard') {
    const category = (url.searchParams.get('category') || 'fastest_lap') as LeaderboardCategory
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(leaderboardManager.getCategory(category, 50)))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      name: 'BrowserCar Realtime Multiplayer Server',
      status: 'running',
      port: PORT,
      serverTick: currentServerTick,
      tickRateHz: SERVER_TICK_RATE,
      healthEndpoint: '/health',
      leaderboardsEndpoint: '/api/leaderboards',
    })
  )
})

// 2. Attach Socket.IO Server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
})

leaderboardManager.setSocketServer(io)

const onlineRaceManager = new OnlineRaceManager(io, leaderboardManager)
const defaultRaceRoom = roomManager.getRoom(DEFAULT_RACE_ROOM_ID)
if (defaultRaceRoom) {
  onlineRaceManager.getOrCreateSession(defaultRaceRoom)
}

const onlineDriftManager = new OnlineDriftManager(io, leaderboardManager)
const defaultDriftRoom = roomManager.getRoom(DEFAULT_DRIFT_ROOM_ID)
if (defaultDriftRoom) {
  onlineDriftManager.getOrCreateSession(defaultDriftRoom)
}

let roomListBroadcastTimer: NodeJS.Timeout | null = null
function broadcastRoomList() {
  if (roomListBroadcastTimer) return
  roomListBroadcastTimer = setTimeout(() => {
    roomListBroadcastTimer = null
    io.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())
  }, 100)
}

// 3. Authoritative Server Tick Loop (20 Hz = every 50ms)
setInterval(() => {
  currentServerTick++
  const rooms = roomManager.getAllRooms()

  for (const room of rooms) {
    if (room.currentPlayers > 0) {
      const isDirty = roomManager.isRoomDirty(room.id)
      // Broadcast snapshot immediately at 20Hz if room is active/dirty, or send heartbeat at 2Hz (every 10 ticks = 500ms)
      if (isDirty || currentServerTick % 10 === 0) {
        const snapshot = roomManager.getRoomSnapshot(room.id, currentServerTick)
        if (snapshot && snapshot.states.length > 0) {
          io.to(room.id).emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot)
        }
        roomManager.clearRoomDirty(room.id)
      }
    }
  }
}, SERVER_TICK_INTERVAL_MS)

// 4. Socket.IO Connection & Event Handlers
io.on('connection', socket => {
  const auth = (socket.handshake.auth || {}) as {
    playerId?: string
    displayName?: string
    lastRoomId?: string
  }
  const preferredPlayerId = typeof auth.playerId === 'string' && auth.playerId.trim()
    ? AntiCheatValidator.sanitizeString(auth.playerId, 32)
    : undefined
  const preferredName = typeof auth.displayName === 'string' && auth.displayName.trim()
    ? AntiCheatValidator.sanitizeString(auth.displayName, 24)
    : undefined
  const player = playerManager.registerPlayer(socket.id, preferredName, preferredPlayerId)
  console.log(`[Multiplayer] Client connected: socket=${socket.id} -> player=${player.id} (${player.name})`)

  const initPayload: PlayerInitPayload = {
    playerId: player.id,
    serverTime: Date.now(),
    version: '1.0.0',
  }
  socket.emit(SOCKET_EVENTS.PLAYER_INIT, initPayload)
  socket.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())

  // Intelligent Reconnect / Room Recovery (Phase 27)
  let targetRoomId = DEFAULT_GLOBAL_ROOM_ID
  let fallbackReason: { reason: string; message: string } | null = null

  if (auth.lastRoomId && auth.lastRoomId !== DEFAULT_GLOBAL_ROOM_ID) {
    const existing = roomManager.getRoom(auth.lastRoomId)
    if (!existing) {
      fallbackReason = {
        reason: 'ROOM_LOST',
        message: 'Önceki oda kapandığı veya bulunamadığı için Genel Şehir Odasına aktarıldınız.',
      }
    } else if (existing.currentPlayers >= existing.maxPlayers && !existing.players.some(p => p.id === player.id)) {
      fallbackReason = {
        reason: 'ROOM_FULL',
        message: 'Önceki oda dolduğu için Genel Şehir Odasına aktarıldınız.',
      }
    } else {
      targetRoomId = auth.lastRoomId
    }
  }

  const joinResult = roomManager.joinRoom(targetRoomId, player)
  if (joinResult.success && joinResult.room) {
    playerManager.setPlayerRoom(socket.id, targetRoomId)
    socket.join(targetRoomId)

    const assignedPlayer = joinResult.player || player
    const roomJoinedPayload: RoomJoinedPayload = {
      room: joinResult.room,
      player: assignedPlayer,
    }
    socket.emit(SOCKET_EVENTS.ROOM_JOINED, roomJoinedPayload)

    // Send initial snapshot of room to new player
    const snapshot = roomManager.getRoomSnapshot(targetRoomId, currentServerTick)
    if (snapshot) {
      socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot)
    }

    const playerJoinedPayload: PlayerJoinedRoomPayload = {
      roomId: targetRoomId,
      player: assignedPlayer,
      room: joinResult.room,
    }
    socket.to(targetRoomId).emit(SOCKET_EVENTS.PLAYER_JOINED_ROOM, playerJoinedPayload)

    if (fallbackReason) {
      socket.emit('room:fallback', fallbackReason)
    }

    if (joinResult.room.mode === 'RACE') {
      onlineRaceManager.handlePlayerJoined(joinResult.room, assignedPlayer)
    } else if (joinResult.room.mode === 'DRIFT') {
      onlineDriftManager.getOrCreateSession(joinResult.room)
      onlineDriftManager.addPlayer(joinResult.room.id, assignedPlayer)
    }
  }

  // --- PLAYER: STATE UPDATE & AUTHORITATIVE VALIDATION (PHASE 14 & 28) ---
  socket.on(SOCKET_EVENTS.PLAYER_STATE, (state: PlayerStateMessage) => {
    try {
      if (!state || typeof state !== 'object' || !state.roomId) return
      // Rate limit incoming telemetry to physical transmission bounds (max 40 burst, 30 Hz refill)
      if (!rateLimiter.check(`${socket.id}:state`, 40, 30)) {
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || currentPlayer.id !== state.playerId) return

      state.playerName = currentPlayer.name

      // Authoritative validation
      const result = roomManager.validateAndUpdatePlayerState(state, currentServerTick)
      if (!result.valid || !result.state) return

      // If correction is needed (out-of-bounds, invalid teleport), send reconcile payload
      if (result.needsCorrection) {
        const reconcilePayload: ReconcilePayload = {
          playerId: result.state.playerId,
          lastProcessedSequence: result.state.lastProcessedSequence,
          correctedPosition: result.state.position,
          correctedRotation: result.state.rotation,
          correctedVelocity: result.state.velocity,
          serverTick: currentServerTick,
          serverTime: Date.now(),
          reason: result.correctionReason,
        }
        socket.emit(SOCKET_EVENTS.SERVER_RECONCILE, reconcilePayload)
      }

      // Forward validated state to other members in the room for immediate responsiveness
      socket.to(state.roomId).emit(SOCKET_EVENTS.PLAYER_STATE, result.state)

      // Authoritative Top Speed Tracking (Phase 25)
      if (result.state.speed >= 100) {
        leaderboardManager.recordRecord(
          'city_top_speed',
          result.state.playerId,
          result.state.playerName || 'Pilot',
          'car-sedan',
          'Hız Pilotu',
          Math.round(result.state.speed)
        )
      }
    } catch (err) {
      console.warn('[Multiplayer] Error handling player state update:', err)
    }
  })

  // --- PLAYER: RESET / RESPAWN VALIDATION (PHASE 19 & 28) ---
  socket.on(SOCKET_EVENTS.PLAYER_RESET, (data: PlayerResetRequest, callback?: (response: PlayerResetResponse) => void) => {
    try {
      if (!rateLimiter.check(`${socket.id}:reset`, 2, 0.7)) {
        if (typeof callback === 'function') {
          callback({ success: false, position: [0, 0.45, 0], rotation: [0, 0, 0, 1], reason: 'Rate limit aşıldı. Lütfen bekleyin.' })
        }
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || !data || typeof data !== 'object' || !data.roomId) {
        if (typeof callback === 'function') {
          callback({ success: false, position: [0, 0.45, 0], rotation: [0, 0, 0, 1], reason: 'Geçersiz oyuncu veya oda' })
        }
        return
      }

      const room = roomManager.getRoom(data.roomId)
      let targetPos: [number, number, number] = AntiCheatValidator.isValidVec3(data.position) ? [...data.position] : [0, 0.45, 0]
      let targetRot: [number, number, number, number] = AntiCheatValidator.isValidQuat(data.rotation) ? [...data.rotation] : [0, 0, 0, 1]

      // Legal mode coordinates verification
      let isLegal = true
      if (room?.mode === 'RACE') {
        const distFromTrack = Math.hypot(targetPos[0], targetPos[2] - 600)
        if (distFromTrack > 350 || targetPos[1] < -1.0 || targetPos[1] > 20) {
          isLegal = false
        }
      } else if (room?.mode === 'DRIFT') {
        const distFromDrift = Math.hypot(targetPos[0], targetPos[2] - (-600))
        if (distFromDrift > 300 || targetPos[1] < -1.0 || targetPos[1] > 20) {
          isLegal = false
        }
      } else {
        if (Math.abs(targetPos[0]) > 300 || Math.abs(targetPos[2]) > 300 || targetPos[1] < -1.0 || targetPos[1] > 20) {
          isLegal = false
        }
      }

      if (!isLegal) {
        targetPos = room?.mode === 'RACE' ? [2.5, 0.45, 570] : room?.mode === 'DRIFT' ? [0, 0.45, -600] : [0, 0.45, -25]
        targetRot = [0, 0, 0, 1]
      }

      // Construct validated authoritative state
      const authoritativeState: AuthoritativePlayerState = {
        playerId: currentPlayer.id,
        playerName: currentPlayer.name,
        roomId: data.roomId,
        position: targetPos,
        rotation: targetRot,
        velocity: [0, 0, 0],
        speed: 0,
        steering: 0,
        isBraking: false,
        isDrifting: false,
        isRespawn: true,
        lastProcessedSequence: 0,
        timestamp: Date.now(),
      }

      // Update room state map
      const roomStates = roomManager['playerStatesByRoom']?.get(data.roomId)
      if (roomStates) {
        roomStates.set(currentPlayer.id, authoritativeState)
      }

      // Broadcast respawn immediately to other clients in room
      socket.to(data.roomId).emit(SOCKET_EVENTS.PLAYER_STATE, authoritativeState)

      if (typeof callback === 'function') {
        callback({
          success: true,
          position: targetPos,
          rotation: targetRot,
          reason: data.reason,
        })
      }
    } catch (err) {
      console.warn('[Multiplayer] Error handling player reset:', err)
      if (typeof callback === 'function') {
        callback({ success: false, position: [0, 0.45, 0], rotation: [0, 0, 0, 1], reason: 'Sunucu hatası' })
      }
    }
  })

  // --- PLAYER: PING / LATENCY MEASUREMENT ---
  socket.on('player:ping', (clientTime: number, callback?: (serverTime: number) => void) => {
    if (typeof callback === 'function') {
      callback(Date.now())
    }
  })

  // --- ROOM: CREATE ---
  socket.on(SOCKET_EVENTS.ROOM_CREATE, (data: CreateRoomRequest, callback?: (response: unknown) => void) => {
    try {
      if (!rateLimiter.check(`${socket.id}:room_create`, 3, 0.5)) {
        if (typeof callback === 'function') callback({ success: false, error: 'İstekler çok hızlı. Lütfen bekleyin.' })
        return
      }
      if (!data || typeof data !== 'object') {
        if (typeof callback === 'function') callback({ success: false, error: 'Geçersiz istek biçimi' })
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer) return

      const existingRoom = roomManager.findRoomByPlayerId(currentPlayer.id)
      if (existingRoom) {
        socket.leave(existingRoom.id)
        const leaveRes = roomManager.leaveRoom(existingRoom.id, currentPlayer.id)
        if (!leaveRes.roomDeleted && leaveRes.room) {
          socket.to(existingRoom.id).emit(SOCKET_EVENTS.PLAYER_LEFT_ROOM, {
            roomId: existingRoom.id,
            playerId: currentPlayer.id,
            room: leaveRes.room,
          })
        }
      }

      if (data.playerName) {
        const cleanName = AntiCheatValidator.sanitizeString(data.playerName, 24)
        playerManager.updatePlayerName(socket.id, cleanName)
        currentPlayer.name = cleanName
      }

      const room = roomManager.createRoom(currentPlayer, data)
      playerManager.setPlayerRoom(socket.id, room.id)
      socket.join(room.id)

      console.log(`[Multiplayer] Room created: id=${room.id} name="${room.name}" host=${currentPlayer.id}`)

      const payload: RoomJoinedPayload = {
        room,
        player: { ...currentPlayer, isHost: true },
      }

      if (room.mode === 'RACE') {
        onlineRaceManager.handlePlayerJoined(room, payload.player)
      } else if (room.mode === 'DRIFT') {
        onlineDriftManager.getOrCreateSession(room)
        onlineDriftManager.addPlayer(room.id, payload.player)
      }

      socket.emit(SOCKET_EVENTS.ROOM_JOINED, payload)
      if (typeof callback === 'function') callback({ success: true, room })

      broadcastRoomList()
    } catch (err) {
      console.error('[Multiplayer] Error creating room:', err)
      socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
        code: 'CREATE_ROOM_FAILED',
        message: 'Oda oluşturulurken bir hata oluştu',
      })
      if (typeof callback === 'function') callback({ success: false, error: 'Oda oluşturulamadı' })
    }
  })

  // --- ROOM: JOIN ---
  socket.on(SOCKET_EVENTS.ROOM_JOIN, (data: JoinRoomRequest, callback?: (response: unknown) => void) => {
    try {
      if (!rateLimiter.check(`${socket.id}:room_join`, 6, 1.5)) {
        if (typeof callback === 'function') callback({ success: false, error: 'İstekler çok hızlı. Lütfen bekleyin.' })
        return
      }
      if (!data || typeof data !== 'object') {
        if (typeof callback === 'function') callback({ success: false, error: 'Geçersiz istek biçimi' })
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer) return

      if (data.playerName) {
        playerManager.updatePlayerName(socket.id, data.playerName)
        currentPlayer.name = data.playerName
      }

      const existingRoom = roomManager.findRoomByPlayerId(currentPlayer.id)
      if (existingRoom && existingRoom.id !== data.roomId) {
        socket.leave(existingRoom.id)
        const leaveRes = roomManager.leaveRoom(existingRoom.id, currentPlayer.id)
        if (!leaveRes.roomDeleted && leaveRes.room) {
          socket.to(existingRoom.id).emit(SOCKET_EVENTS.PLAYER_LEFT_ROOM, {
            roomId: existingRoom.id,
            playerId: currentPlayer.id,
            room: leaveRes.room,
          })
        }
      }

      const identifier = data?.roomCode || data?.roomId || ''
      if (!identifier) {
        socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
          code: 'MALFORMED_MESSAGE',
          message: 'Geçersiz oda kimliği veya kodu.',
        })
        if (typeof callback === 'function') callback({ success: false, error: 'Geçersiz oda kimliği' })
        return
      }

      const joinResult = roomManager.joinRoom(identifier, currentPlayer)
      if (!joinResult.success || !joinResult.room) {
        const isFull = joinResult.error === 'Oda dolu'
        const isNotFound = joinResult.error === 'Oda bulunamadı'
        const code = isFull ? 'ROOM_FULL' : isNotFound ? 'ROOM_NOT_FOUND' : 'JOIN_ROOM_FAILED'
        const message = isFull
          ? 'Oda dolu (Maksimum oyuncu sınırına ulaşıldı).'
          : isNotFound
          ? 'Oda bulunamadı veya kapatılmış.'
          : joinResult.error || 'Odaya katılınamadı'

        socket.emit(SOCKET_EVENTS.SERVER_ERROR, { code, message })
        if (typeof callback === 'function') callback({ success: false, error: message })
        return
      }

      const room = joinResult.room
      playerManager.setPlayerRoom(socket.id, room.id)
      socket.join(room.id)

      console.log(`[Multiplayer] Player ${currentPlayer.id} joined room ${room.id} (${room.currentPlayers}/${room.maxPlayers})`)

      const assignedPlayer = joinResult.player || currentPlayer
      const roomJoinedPayload: RoomJoinedPayload = {
        room,
        player: assignedPlayer,
      }
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, roomJoinedPayload)

      // Send initial snapshot of new room
      const roomSnapshot = roomManager.getRoomSnapshot(room.id, currentServerTick)
      if (roomSnapshot) {
        socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, roomSnapshot)
      }

      const playerJoinedPayload: PlayerJoinedRoomPayload = {
        roomId: room.id,
        player: assignedPlayer,
        room,
      }
      socket.to(room.id).emit(SOCKET_EVENTS.PLAYER_JOINED_ROOM, playerJoinedPayload)

      if (room.mode === 'RACE') {
        onlineRaceManager.handlePlayerJoined(room, assignedPlayer)
      } else if (room.mode === 'DRIFT') {
        onlineDriftManager.getOrCreateSession(room)
        onlineDriftManager.addPlayer(room.id, assignedPlayer)
      }

      if (typeof callback === 'function') callback({ success: true, room })

      broadcastRoomList()
    } catch (err) {
      console.error('[Multiplayer] Error joining room:', err)
      socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
        code: 'JOIN_ROOM_FAILED',
        message: 'Odaya katılırken beklenmeyen hata oluştu',
      })
      if (typeof callback === 'function') callback({ success: false, error: 'Odaya katılım başarısız' })
    }
  })

  // --- ROOM: QUICK JOIN ---
  socket.on(SOCKET_EVENTS.ROOM_QUICK_JOIN, (data: QuickJoinRequest, callback?: (response: unknown) => void) => {
    try {
      if (!rateLimiter.check(`${socket.id}:room_join`, 6, 1.5)) {
        if (typeof callback === 'function') callback({ success: false, error: 'İstekler çok hızlı. Lütfen bekleyin.' })
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer) return

      if (data?.playerName) {
        const cleanName = AntiCheatValidator.sanitizeString(data.playerName, 24)
        playerManager.updatePlayerName(socket.id, cleanName)
        currentPlayer.name = cleanName
      }

      const roomToJoin = roomManager.findQuickJoinRoom(data?.preferredMode)

      const existingRoom = roomManager.findRoomByPlayerId(currentPlayer.id)
      if (existingRoom && existingRoom.id !== roomToJoin.id) {
        socket.leave(existingRoom.id)
        const leaveRes = roomManager.leaveRoom(existingRoom.id, currentPlayer.id)
        if (!leaveRes.roomDeleted && leaveRes.room) {
          socket.to(existingRoom.id).emit(SOCKET_EVENTS.PLAYER_LEFT_ROOM, {
            roomId: existingRoom.id,
            playerId: currentPlayer.id,
            room: leaveRes.room,
          })
        }
      }

      const joinResult = roomManager.joinRoom(roomToJoin.id, currentPlayer)
      if (!joinResult.success || !joinResult.room) {
        const isFull = joinResult.error === 'Oda dolu'
        const code = isFull ? 'ROOM_FULL' : 'JOIN_ROOM_FAILED'
        const message = isFull
          ? 'Uygun odaların tamamı dolu. Lütfen yeni bir oda oluşturun.'
          : joinResult.error || 'Hızlı odaya katılınamadı'

        socket.emit(SOCKET_EVENTS.SERVER_ERROR, { code, message })
        if (typeof callback === 'function') callback({ success: false, error: message })
        return
      }

      const room = joinResult.room
      playerManager.setPlayerRoom(socket.id, room.id)
      socket.join(room.id)

      console.log(`[Multiplayer] Quick join: Player ${currentPlayer.id} joined room ${room.id} (${room.currentPlayers}/${room.maxPlayers})`)

      const assignedPlayer = joinResult.player || currentPlayer
      const roomJoinedPayload: RoomJoinedPayload = {
        room,
        player: assignedPlayer,
      }
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, roomJoinedPayload)

      const roomSnapshot = roomManager.getRoomSnapshot(room.id, currentServerTick)
      if (roomSnapshot) {
        socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, roomSnapshot)
      }

      const playerJoinedPayload: PlayerJoinedRoomPayload = {
        roomId: room.id,
        player: assignedPlayer,
        room,
      }
      socket.to(room.id).emit(SOCKET_EVENTS.PLAYER_JOINED_ROOM, playerJoinedPayload)

      if (room.mode === 'RACE') {
        onlineRaceManager.handlePlayerJoined(room, assignedPlayer)
      } else if (room.mode === 'DRIFT') {
        onlineDriftManager.getOrCreateSession(room)
        onlineDriftManager.addPlayer(room.id, assignedPlayer)
      }

      if (typeof callback === 'function') callback({ success: true, room })

      broadcastRoomList()
    } catch (err) {
      console.error('[Multiplayer] Error in quick join:', err)
      socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
        code: 'QUICK_JOIN_FAILED',
        message: 'Hızlı katılırken beklenmeyen hata oluştu',
      })
      if (typeof callback === 'function') callback({ success: false, error: 'Hızlı katılım başarısız' })
    }
  })

  // --- ROOM: LEAVE ---
  socket.on(SOCKET_EVENTS.ROOM_LEAVE, (data?: LeaveRoomRequest, callback?: (response: unknown) => void) => {
    try {
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer) return

      const room = data?.roomId ? roomManager.getRoom(data.roomId) : roomManager.findRoomByPlayerId(currentPlayer.id)
      if (!room) {
        if (typeof callback === 'function') callback({ success: true })
        return
      }

      socket.leave(room.id)
      playerManager.setPlayerRoom(socket.id, undefined)
      const leaveResult = roomManager.leaveRoom(room.id, currentPlayer.id)

      console.log(`[Multiplayer] Player ${currentPlayer.id} left room ${room.id}`)

      if (room.mode === 'RACE') {
        onlineRaceManager.handlePlayerLeft(room, currentPlayer.id)
      } else if (room.mode === 'DRIFT') {
        onlineDriftManager.removePlayer(room.id, currentPlayer.id)
      }

      socket.emit(SOCKET_EVENTS.ROOM_LEFT, { roomId: room.id, playerId: currentPlayer.id })

      if (!leaveResult.roomDeleted && leaveResult.room) {
        const payload: PlayerLeftRoomPayload = {
          roomId: room.id,
          playerId: currentPlayer.id,
          room: leaveResult.room,
        }
        socket.to(room.id).emit(SOCKET_EVENTS.PLAYER_LEFT_ROOM, payload)
      }

      // Rejoin default global room
      if (room.id !== DEFAULT_GLOBAL_ROOM_ID) {
        const defaultJoin = roomManager.joinRoom(DEFAULT_GLOBAL_ROOM_ID, currentPlayer)
        if (defaultJoin.success && defaultJoin.room) {
          playerManager.setPlayerRoom(socket.id, DEFAULT_GLOBAL_ROOM_ID)
          socket.join(DEFAULT_GLOBAL_ROOM_ID)
          socket.emit(SOCKET_EVENTS.ROOM_JOINED, { room: defaultJoin.room, player: currentPlayer })
          socket.to(DEFAULT_GLOBAL_ROOM_ID).emit(SOCKET_EVENTS.PLAYER_JOINED_ROOM, {
            roomId: DEFAULT_GLOBAL_ROOM_ID,
            player: currentPlayer,
            room: defaultJoin.room,
          })
        }
      }

      if (typeof callback === 'function') callback({ success: true })

      broadcastRoomList()
    } catch (err) {
      console.error('[Multiplayer] Error leaving room:', err)
      if (typeof callback === 'function') callback({ success: false })
    }
  })

  // --- ROOM: LIST REQUEST ---
  socket.on(SOCKET_EVENTS.ROOM_LIST, () => {
    socket.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())
  })

  // --- DISCONNECT ---
  socket.on('disconnect', reason => {
    rateLimiter.clearClient(socket.id)
    const player = playerManager.unregisterPlayer(socket.id)
    if (player) {
      console.log(`[Multiplayer] Client disconnected: player=${player.id} reason=${reason}`)

      const room = roomManager.findRoomByPlayerId(player.id)
      if (room) {
        if (room.mode === 'RACE') {
          onlineRaceManager.handlePlayerLeft(room, player.id)
        } else if (room.mode === 'DRIFT') {
          onlineDriftManager.removePlayer(room.id, player.id)
        }
        const leaveResult = roomManager.leaveRoom(room.id, player.id)
        if (!leaveResult.roomDeleted && leaveResult.room) {
          const payload: PlayerLeftRoomPayload = {
            roomId: room.id,
            playerId: player.id,
            room: leaveResult.room,
          }
          socket.to(room.id).emit(SOCKET_EVENTS.PLAYER_LEFT_ROOM, payload)
        }
        broadcastRoomList()
      }
    }
  })

  // --- ONLINE RACE LIFECYCLE (PHASE 16 & 28) ---
  socket.on(SOCKET_EVENTS.RACE_READY_TOGGLE, (ready: boolean) => {
    try {
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || !currentPlayer.roomId) return
      const room = roomManager.getRoom(currentPlayer.roomId)
      if (room && room.mode === 'RACE') {
        onlineRaceManager.toggleReady(room, currentPlayer.id, !!ready)
      }
    } catch (err) {
      console.warn('[Multiplayer] Error in race:ready_toggle:', err)
    }
  })

  socket.on(SOCKET_EVENTS.RACE_CHECKPOINT_PASS, (data: RaceCheckpointPassRequest) => {
    try {
      if (!rateLimiter.check(`${socket.id}:race_cp`, 4, 1.5)) {
        return // Rate limit checkpoint pass events
      }
      if (!data || typeof data !== 'object' || typeof data.checkpointIndex !== 'number') {
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || !currentPlayer.roomId) return
      const room = roomManager.getRoom(currentPlayer.roomId)
      if (room && room.mode === 'RACE') {
        onlineRaceManager.handleCheckpointPass(
          room,
          currentPlayer.id,
          data.checkpointIndex,
          data.lap,
          data.position
        )
      }
    } catch (err) {
      console.warn('[Multiplayer] Error in race:checkpoint_pass:', err)
    }
  })

  socket.on(SOCKET_EVENTS.RACE_REMATCH, () => {
    try {
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || !currentPlayer.roomId) return
      const room = roomManager.getRoom(currentPlayer.roomId)
      if (room && room.mode === 'RACE') {
        onlineRaceManager.rematch(room)
      }
    } catch (err) {
      console.warn('[Multiplayer] Error in race:rematch:', err)
    }
  })

  // --- ONLINE DRIFT LIFECYCLE (PHASE 17 & 28) ---
  socket.on(SOCKET_EVENTS.DRIFT_READY_TOGGLE, () => {
    try {
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || !currentPlayer.roomId) return
      const room = roomManager.getRoom(currentPlayer.roomId)
      if (room && room.mode === 'DRIFT') {
        onlineDriftManager.toggleReady(room.id, currentPlayer.id)
      }
    } catch (err) {
      console.warn('[Multiplayer] Error in drift:ready_toggle:', err)
    }
  })

  socket.on(SOCKET_EVENTS.DRIFT_SCORE_SUBMISSION, (data: DriftScoreSubmission) => {
    try {
      if (!rateLimiter.check(`${socket.id}:drift_score`, 35, 25)) {
        return // Rate limit high-frequency drift submissions
      }
      if (!data || typeof data !== 'object') {
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || !currentPlayer.roomId) return
      const room = roomManager.getRoom(currentPlayer.roomId)
      if (room && room.mode === 'DRIFT') {
        onlineDriftManager.processScoreSubmission(currentPlayer.id, data)
      }
    } catch (err) {
      console.warn('[Multiplayer] Error in drift:score_submission:', err)
    }
  })

  socket.on(SOCKET_EVENTS.DRIFT_REMATCH, () => {
    try {
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || !currentPlayer.roomId) return
      const room = roomManager.getRoom(currentPlayer.roomId)
      if (room && room.mode === 'DRIFT') {
        onlineDriftManager.rematch(room.id)
      }
    } catch (err) {
      console.warn('[Multiplayer] Error in drift:rematch:', err)
    }
  })

  // --- LEADERBOARDS (PHASE 25 & 28) ---
  socket.on(SOCKET_EVENTS.LEADERBOARD_ALL, (callback?: (data: unknown) => void) => {
    try {
      const all = leaderboardManager.getAll(50)
      if (typeof callback === 'function') {
        callback(all)
      } else {
        socket.emit(SOCKET_EVENTS.LEADERBOARD_ALL, all)
      }
    } catch (err) {
      console.warn('[Leaderboard] Error fetching all leaderboards:', err)
    }
  })

  socket.on(SOCKET_EVENTS.LEADERBOARD_GET, (category: LeaderboardCategory, callback?: (data: unknown) => void) => {
    try {
      const catData = leaderboardManager.getCategory(category || 'fastest_lap', 50)
      if (typeof callback === 'function') {
        callback(catData)
      } else {
        socket.emit(SOCKET_EVENTS.LEADERBOARD_DATA, catData)
      }
    } catch (err) {
      console.warn('[Leaderboard] Error fetching category leaderboard:', err)
    }
  })

  socket.on(SOCKET_EVENTS.LEADERBOARD_SUBMIT, (data: LeaderboardSubmitRequest, callback?: (res: unknown) => void) => {
    try {
      if (!rateLimiter.check(`${socket.id}:lb_submit`, 3, 1.0)) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'İstekler çok hızlı gönderiliyor (Rate limit).' })
        }
        return
      }

      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      const auth = (socket.handshake.auth || {}) as { playerId?: string; displayName?: string }
      const playerId = currentPlayer ? currentPlayer.id : (auth.playerId || socket.id)
      const playerName = currentPlayer ? currentPlayer.name : (auth.displayName || 'Anonim Pilot')

      const result = leaderboardManager.processClientSubmission(playerId, playerName, data)
      if (typeof callback === 'function') {
        callback(result)
      }
    } catch (err) {
      console.warn('[Leaderboard] Error submitting leaderboard record:', err)
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Sunucu hatası' })
      }
    }
  })
})

// 5. Start Server
httpServer.listen(PORT, HOST, () => {
  console.log(`===============================================`)
  console.log(`🚀 BrowserCar Authoritative Multiplayer Server is running!`)
  console.log(`📡 URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  console.log(`⏱️ Tick Rate: ${SERVER_TICK_RATE} Hz (${SERVER_TICK_INTERVAL_MS}ms)`)
  console.log(`🩺 Health check: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`)
  console.log(`⚡ Ready for authoritative simulation & vehicle sync`)
  console.log(`===============================================`)
})

// 6. Graceful Shutdown Handlers (Phase 30)
function handleShutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}, shutting down gracefully...`)
  try {
    io.emit(SOCKET_EVENTS.SERVER_ERROR, {
      code: 'SERVER_SHUTTING_DOWN',
      message: 'Sunucu yeniden başlatılıyor veya kapatılıyor...',
    })
    io.close(() => {
      httpServer.close(() => {
        console.log('[Server] HTTP and Socket.IO servers closed cleanly.')
        process.exit(0)
      })
    })
  } catch (err) {
    console.error('[Server] Error during graceful shutdown:', err)
    process.exit(1)
  }

  // Force exit after 5 seconds if connections linger
  setTimeout(() => {
    console.error('[Server] Forced shutdown: timeout exceeded.')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))
