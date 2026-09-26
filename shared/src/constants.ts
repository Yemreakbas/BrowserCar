export const DEFAULT_SERVER_PORT = 3001
export const DEFAULT_SERVER_URL = `http://localhost:${DEFAULT_SERVER_PORT}`
export const DEFAULT_GLOBAL_ROOM_ID = 'room_city_global'
export const DEFAULT_RACE_ROOM_ID = 'room_race_circuit'
export const DEFAULT_DRIFT_ROOM_ID = 'room_drift_arena'

export const SERVER_TICK_RATE = 20 // 20 Hz = 50ms tick interval
export const SERVER_TICK_INTERVAL_MS = 1000 / SERVER_TICK_RATE // 50ms
export const CLIENT_SEND_RATE = 20 // 20 Hz
export const CLIENT_SEND_INTERVAL_MS = 1000 / CLIENT_SEND_RATE // 50ms

export const OnlineRaceState = {
  LOBBY: 'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  FINISHED: 'FINISHED',
} as const
export type OnlineRaceState = (typeof OnlineRaceState)[keyof typeof OnlineRaceState]

export const OnlineDriftState = {
  LOBBY: 'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  ACTIVE: 'ACTIVE',
  FINISHED: 'FINISHED',
} as const
export type OnlineDriftState = (typeof OnlineDriftState)[keyof typeof OnlineDriftState]

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
  ROOM_QUICK_JOIN: 'room:quick_join',
  ROOM_LEAVE: 'room:leave',
  ROOM_LEFT: 'room:left',
  ROOM_LIST: 'room:list',
  ROOM_LIST_RESPONSE: 'room:list_response',

  // Room presence notifications
  PLAYER_JOINED_ROOM: 'room:player_joined',
  PLAYER_LEFT_ROOM: 'room:player_left',

  // Player state & authoritative sync (Phase 13 & 14)
  PLAYER_STATE: 'player:state',
  PLAYER_RESET: 'player:reset',
  ROOM_SNAPSHOT: 'room:snapshot',
  SERVER_RECONCILE: 'player:reconcile',

  // Online Race Lifecycle (Phase 16)
  RACE_READY_TOGGLE: 'race:ready_toggle',
  RACE_ROOM_UPDATE: 'race:room_update',
  RACE_START_COUNTDOWN: 'race:start_countdown',
  RACE_STARTED: 'race:started',
  RACE_CHECKPOINT_PASS: 'race:checkpoint_pass',
  RACE_PLAYER_PROGRESS: 'race:player_progress',
  RACE_PLAYER_FINISHED: 'race:player_finished',
  RACE_RESULTS: 'race:results',
  RACE_REMATCH: 'race:rematch',

  // Online Drift Lifecycle (Phase 17)
  DRIFT_READY_TOGGLE: 'drift:ready_toggle',
  DRIFT_ROOM_UPDATE: 'drift:room_update',
  DRIFT_START_COUNTDOWN: 'drift:start_countdown',
  DRIFT_STARTED: 'drift:started',
  DRIFT_SCORE_SUBMISSION: 'drift:score_submission',
  DRIFT_LEADERBOARD_UPDATE: 'drift:leaderboard_update',
  DRIFT_SESSION_FINISHED: 'drift:session_finished',
  DRIFT_REMATCH: 'drift:rematch',

  // Errors / alerts
  SERVER_ERROR: 'server:error',
} as const

