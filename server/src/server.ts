import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_GLOBAL_ROOM_ID,
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
} from '../../shared/src/messages.ts'
import { PlayerManager } from './players/PlayerManager.ts'
import { RoomManager } from './rooms/RoomManager.ts'

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT
const startTime = Date.now()
let currentServerTick = 0

const playerManager = new PlayerManager()
const roomManager = new RoomManager()

// 1. Create HTTP Server with Health & Status Endpoints
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
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

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      name: 'BrowserCar Realtime Multiplayer Server',
      status: 'running',
      port: PORT,
      serverTick: currentServerTick,
      tickRateHz: SERVER_TICK_RATE,
      healthEndpoint: '/health',
    })
  )
})

// 2. Attach Socket.IO Server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
})

function broadcastRoomList() {
  io.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())
}

// 3. Authoritative Server Tick Loop (20 Hz = every 50ms)
setInterval(() => {
  currentServerTick++
  const rooms = roomManager.getAllRooms()

  for (const room of rooms) {
    if (room.currentPlayers > 0) {
      const snapshot = roomManager.getRoomSnapshot(room.id, currentServerTick)
      if (snapshot && snapshot.states.length > 0) {
        io.to(room.id).emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot)
      }
    }
  }
}, SERVER_TICK_INTERVAL_MS)

// 4. Socket.IO Connection & Event Handlers
io.on('connection', socket => {
  const player = playerManager.registerPlayer(socket.id)
  console.log(`[Multiplayer] Client connected: socket=${socket.id} -> player=${player.id} (${player.name})`)

  const initPayload: PlayerInitPayload = {
    playerId: player.id,
    serverTime: Date.now(),
    version: '1.0.0',
  }
  socket.emit(SOCKET_EVENTS.PLAYER_INIT, initPayload)
  socket.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())

  // Auto-join default global city room
  const defaultJoin = roomManager.joinRoom(DEFAULT_GLOBAL_ROOM_ID, player)
  if (defaultJoin.success && defaultJoin.room) {
    playerManager.setPlayerRoom(socket.id, DEFAULT_GLOBAL_ROOM_ID)
    socket.join(DEFAULT_GLOBAL_ROOM_ID)

    const roomJoinedPayload: RoomJoinedPayload = {
      room: defaultJoin.room,
      player,
    }
    socket.emit(SOCKET_EVENTS.ROOM_JOINED, roomJoinedPayload)

    // Send initial snapshot of room to new player
    const snapshot = roomManager.getRoomSnapshot(DEFAULT_GLOBAL_ROOM_ID, currentServerTick)
    if (snapshot) {
      socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot)
    }

    const playerJoinedPayload: PlayerJoinedRoomPayload = {
      roomId: DEFAULT_GLOBAL_ROOM_ID,
      player,
      room: defaultJoin.room,
    }
    socket.to(DEFAULT_GLOBAL_ROOM_ID).emit(SOCKET_EVENTS.PLAYER_JOINED_ROOM, playerJoinedPayload)
  }

  // --- PLAYER: STATE UPDATE & AUTHORITATIVE VALIDATION (PHASE 14) ---
  socket.on(SOCKET_EVENTS.PLAYER_STATE, (state: PlayerStateMessage) => {
    try {
      if (!state || !state.roomId) return
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
    } catch (err) {
      console.warn('[Multiplayer] Error handling player state update:', err)
    }
  })

  // --- ROOM: CREATE ---
  socket.on(SOCKET_EVENTS.ROOM_CREATE, (data: CreateRoomRequest, callback?: (response: unknown) => void) => {
    try {
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
        playerManager.updatePlayerName(socket.id, data.playerName)
        currentPlayer.name = data.playerName
      }

      const room = roomManager.createRoom(currentPlayer, data)
      playerManager.setPlayerRoom(socket.id, room.id)
      socket.join(room.id)

      console.log(`[Multiplayer] Room created: id=${room.id} name="${room.name}" host=${currentPlayer.id}`)

      const payload: RoomJoinedPayload = {
        room,
        player: { ...currentPlayer, isHost: true },
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

      const joinResult = roomManager.joinRoom(data.roomId, currentPlayer)
      if (!joinResult.success || !joinResult.room) {
        socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
          code: 'JOIN_ROOM_FAILED',
          message: joinResult.error || 'Odaya katılınamadı',
        })
        if (typeof callback === 'function') callback({ success: false, error: joinResult.error })
        return
      }

      const room = joinResult.room
      playerManager.setPlayerRoom(socket.id, room.id)
      socket.join(room.id)

      console.log(`[Multiplayer] Player ${currentPlayer.id} joined room ${room.id} (${room.currentPlayers}/${room.maxPlayers})`)

      const roomJoinedPayload: RoomJoinedPayload = {
        room,
        player: currentPlayer,
      }
      socket.emit(SOCKET_EVENTS.ROOM_JOINED, roomJoinedPayload)

      // Send initial snapshot of new room
      const roomSnapshot = roomManager.getRoomSnapshot(room.id, currentServerTick)
      if (roomSnapshot) {
        socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, roomSnapshot)
      }

      const playerJoinedPayload: PlayerJoinedRoomPayload = {
        roomId: room.id,
        player: currentPlayer,
        room,
      }
      socket.to(room.id).emit(SOCKET_EVENTS.PLAYER_JOINED_ROOM, playerJoinedPayload)

      if (typeof callback === 'function') callback({ success: true, room })

      broadcastRoomList()
    } catch (err) {
      console.error('[Multiplayer] Error joining room:', err)
      socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
        code: 'JOIN_ROOM_FAILED',
        message: 'Odaya katılırken beklenmeyen hata oluştu',
      })
      if (typeof callback === 'function') callback({ success: false, error: 'Beklenmeyen hata' })
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
    const player = playerManager.unregisterPlayer(socket.id)
    if (player) {
      console.log(`[Multiplayer] Client disconnected: player=${player.id} reason=${reason}`)

      const room = roomManager.findRoomByPlayerId(player.id)
      if (room) {
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
})

// 5. Start Server
httpServer.listen(PORT, () => {
  console.log(`===============================================`)
  console.log(`🚀 BrowserCar Authoritative Multiplayer Server is running!`)
  console.log(`📡 URL: http://localhost:${PORT}`)
  console.log(`⏱️ Tick Rate: ${SERVER_TICK_RATE} Hz (${SERVER_TICK_INTERVAL_MS}ms)`)
  console.log(`🩺 Health check: http://localhost:${PORT}/health`)
  console.log(`⚡ Ready for authoritative simulation & vehicle sync`)
  console.log(`===============================================`)
})
