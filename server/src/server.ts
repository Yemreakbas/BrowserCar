import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { DEFAULT_SERVER_PORT, DEFAULT_GLOBAL_ROOM_ID, SOCKET_EVENTS } from '../../shared/src/constants.ts'
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
} from '../../shared/src/messages.ts'
import { PlayerManager } from './players/PlayerManager.ts'
import { RoomManager } from './rooms/RoomManager.ts'

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT
const startTime = Date.now()

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

// 3. Socket.IO Connection & Event Handlers
io.on('connection', socket => {
  // Register player and assign unique ID
  const player = playerManager.registerPlayer(socket.id)
  console.log(`[Multiplayer] Client connected: socket=${socket.id} -> player=${player.id} (${player.name})`)

  // Send initialization payload
  const initPayload: PlayerInitPayload = {
    playerId: player.id,
    serverTime: Date.now(),
    version: '1.0.0',
  }
  socket.emit(SOCKET_EVENTS.PLAYER_INIT, initPayload)

  // Send room list
  socket.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())

  // Auto-join default global city room so two players immediately see each other!
  const defaultJoin = roomManager.joinRoom(DEFAULT_GLOBAL_ROOM_ID, player)
  if (defaultJoin.success && defaultJoin.room) {
    playerManager.setPlayerRoom(socket.id, DEFAULT_GLOBAL_ROOM_ID)
    socket.join(DEFAULT_GLOBAL_ROOM_ID)

    const roomJoinedPayload: RoomJoinedPayload = {
      room: defaultJoin.room,
      player,
    }
    socket.emit(SOCKET_EVENTS.ROOM_JOINED, roomJoinedPayload)

    // Send snapshot of existing players' states in the room to new player
    const existingStates = roomManager.getRoomSnapshot(DEFAULT_GLOBAL_ROOM_ID)
    if (existingStates.length > 0) {
      const snapshot: RoomSnapshotPayload = {
        roomId: DEFAULT_GLOBAL_ROOM_ID,
        serverTime: Date.now(),
        states: existingStates,
      }
      socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, snapshot)
    }

    // Notify other players in the room
    const playerJoinedPayload: PlayerJoinedRoomPayload = {
      roomId: DEFAULT_GLOBAL_ROOM_ID,
      player,
      room: defaultJoin.room,
    }
    socket.to(DEFAULT_GLOBAL_ROOM_ID).emit(SOCKET_EVENTS.PLAYER_JOINED_ROOM, playerJoinedPayload)
  }

  // --- PLAYER: STATE UPDATE (PHASE 13) ---
  socket.on(SOCKET_EVENTS.PLAYER_STATE, (state: PlayerStateMessage) => {
    try {
      if (!state || !state.roomId) return
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer || currentPlayer.id !== state.playerId) return

      state.playerName = currentPlayer.name
      roomManager.updatePlayerState(state)

      // Broadcast to other players in the same room
      socket.to(state.roomId).emit(SOCKET_EVENTS.PLAYER_STATE, state)
    } catch (err) {
      console.warn('[Multiplayer] Error handling player state update:', err)
    }
  })

  // --- ROOM: CREATE ---
  socket.on(SOCKET_EVENTS.ROOM_CREATE, (data: CreateRoomRequest, callback?: (response: unknown) => void) => {
    try {
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer) return

      // Leave previous room if any
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

      // Check existing room
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

      // Send snapshot of states in new room to joining player
      const roomStates = roomManager.getRoomSnapshot(room.id)
      if (roomStates.length > 0) {
        socket.emit(SOCKET_EVENTS.ROOM_SNAPSHOT, {
          roomId: room.id,
          serverTime: Date.now(),
          states: roomStates,
        })
      }

      // Notify others in room
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

      // Automatically rejoin the default global city room
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

// 4. Start Server
httpServer.listen(PORT, () => {
  console.log(`===============================================`)
  console.log(`🚀 BrowserCar Multiplayer Server is running!`)
  console.log(`📡 URL: http://localhost:${PORT}`)
  console.log(`🩺 Health check: http://localhost:${PORT}/health`)
  console.log(`⚡ Ready for player connections & room management`)
  console.log(`===============================================`)
})
