export const DEFAULT_SERVER_PORT = 3001
export const DEFAULT_SERVER_URL = `http://localhost:${DEFAULT_SERVER_PORT}`
export const DEFAULT_GLOBAL_ROOM_ID = 'room_city_global'

export const SERVER_TICK_RATE = 20 // 20 Hz = 50ms tick interval
export const SERVER_TICK_INTERVAL_MS = 1000 / SERVER_TICK_RATE // 50ms
export const CLIENT_SEND_RATE = 20 // 20 Hz
export const CLIENT_SEND_INTERVAL_MS = 1000 / CLIENT_SEND_RATE // 50ms

export const SOCKET_EVENTS = {
  // Connection / lifecycle
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  PLAYER_INIT: 'player:init',

  // Rooms
  ROOM_CREATE: 'room:create',
  ROOM_CREATED: 'room:created',
  ROOM_JOIN: 'room:join',
  ROOM_JOINED: 'room:joined',
  ROOM_LEAVE: 'room:leave',
  ROOM_LEFT: 'room:left',
  ROOM_LIST: 'room:list',
  ROOM_LIST_RESPONSE: 'room:list_response',

  // Room presence notifications
  PLAYER_JOINED_ROOM: 'room:player_joined',
  PLAYER_LEFT_ROOM: 'room:player_left',

  // Player state & authoritative sync (Phase 13 & 14)
  PLAYER_STATE: 'player:state',
  ROOM_SNAPSHOT: 'room:snapshot',
  SERVER_RECONCILE: 'player:reconcile',

  // Errors / alerts
  SERVER_ERROR: 'server:error',
} as const
