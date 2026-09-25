import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { DEFAULT_SERVER_PORT, SOCKET_EVENTS } from '../../shared/src/constants.ts'
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  PlayerInitPayload,
  RoomJoinedPayload,
  PlayerJoinedRoomPayload,
  PlayerLeftRoomPayload,
} from '../../shared/src/messages.ts'
import { PlayerManager } from './players/PlayerManager.ts'
import { RoomManager } from './rooms/RoomManager.ts'

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT
const startTime = Date.now()

const playerManager = new PlayerManager()
const roomManager = new RoomManager()

// 1. Create HTTP Server with Health & Status Endpoints
const httpServer = http.createServer((req, res) => {
  // Enable CORS for basic HTTP requests
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

  // Default welcome response
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

// Helper to broadcast room list to all connected clients
function broadcastRoomList() {
  io.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())
}

// 3. Socket.IO Connection & Event Handlers
io.on('connection', socket => {
  // Register player and assign unique ID
  const player = playerManager.registerPlayer(socket.id)
  console.log(`[Multiplayer] Client connected: socket=${socket.id} -> player=${player.id} (${player.name})`)

  // Send initialization payload to client
  const initPayload: PlayerInitPayload = {
    playerId: player.id,
    serverTime: Date.now(),
    version: '1.0.0',
  }
  socket.emit(SOCKET_EVENTS.PLAYER_INIT, initPayload)

  // Send current room list
  socket.emit(SOCKET_EVENTS.ROOM_LIST_RESPONSE, roomManager.getAllRooms())

  // --- ROOM: CREATE ---
  socket.on(SOCKET_EVENTS.ROOM_CREATE, (data: CreateRoomRequest, callback?: (response: unknown) => void) => {
    try {
      const currentPlayer = playerManager.getPlayerBySocket(socket.id)
      if (!currentPlayer) return

      // Leave previous room if any
      const existingRoom = roomManager.findRoomByPlayerId(currentPlayer.id)
      if (existingRoom) {
        socket.leave(existingRoom.id)
        roomManager.leaveRoom(existingRoom.id, currentPlayer.id)
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
        roomManager.leaveRoom(existingRoom.id, currentPlayer.id)
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
