export interface PlayerInfo {
  id: string
  name: string
  isHost?: boolean
  connectedAt: number
  ping?: number
}

export interface RoomInfo {
  id: string
  name: string
  mode: string
  map: string
  maxPlayers: number
  currentPlayers: number
  players: PlayerInfo[]
  hostId: string
  createdAt: number
}

export interface PlayerInitPayload {
  playerId: string
  serverTime: number
  version: string
}

export interface CreateRoomRequest {
  name: string
  mode: string
  map: string
  maxPlayers?: number
  playerName?: string
}

export interface JoinRoomRequest {
  roomId: string
  playerName?: string
}

export interface LeaveRoomRequest {
  roomId?: string
}

export interface RoomJoinedPayload {
  room: RoomInfo
  player: PlayerInfo
}

export interface RoomLeftPayload {
  roomId: string
  playerId: string
}

export interface PlayerJoinedRoomPayload {
  roomId: string
  player: PlayerInfo
  room: RoomInfo
}

export interface PlayerLeftRoomPayload {
  roomId: string
  playerId: string
  room: RoomInfo
}

export interface ServerErrorPayload {
  code: string
  message: string
}
