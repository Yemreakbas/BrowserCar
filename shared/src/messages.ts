import type { OnlineRaceState } from './constants.ts'

export interface PlayerInfo {
  id: string
  name: string
  isHost?: boolean
  connectedAt: number
  ping?: number
  spawnIndex?: number
  gridIndex?: number
  color?: number
  isReady?: boolean
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
  raceState?: OnlineRaceState
  raceStartTime?: number
  totalLaps?: number
  countdownRemaining?: number
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

export interface PlayerStateMessage {
  playerId: string
  playerName?: string
  roomId: string
  position: [number, number, number]
  rotation: [number, number, number, number] // [x, y, z, w]
  velocity: [number, number, number]
  speed: number
  steering: number
  isBraking: boolean
  isDrifting: boolean
  sequence?: number
  isRespawn?: boolean
  inputs?: {
    forward: boolean
    backward: boolean
    left: boolean
    right: boolean
    handbrake: boolean
  }
  timestamp: number
}

export interface AuthoritativePlayerState {
  playerId: string
  playerName?: string
  roomId: string
  position: [number, number, number]
  rotation: [number, number, number, number]
  velocity: [number, number, number]
  speed: number
  steering: number
  isBraking: boolean
  isDrifting: boolean
  lastProcessedSequence: number
  isRespawn?: boolean
  timestamp: number
}

export interface RoomSnapshotPayload {
  roomId: string
  serverTick: number
  serverTime: number
  states: AuthoritativePlayerState[]
}

export interface ReconcilePayload {
  playerId: string
  lastProcessedSequence: number
  correctedPosition: [number, number, number]
  correctedRotation: [number, number, number, number]
  correctedVelocity: [number, number, number]
  serverTick: number
  serverTime: number
  reason?: string
}

// --- ONLINE RACE PAYLOADS (PHASE 16) ---

export interface RaceRoomUpdatePayload {
  roomId: string
  raceState: OnlineRaceState
  players: PlayerInfo[]
  countdownRemaining?: number
  startTime?: number
  totalLaps?: number
}

export interface RaceStartCountdownPayload {
  roomId: string
  countdownSeconds: number
  startsAt: number
}

export interface RaceStartedPayload {
  roomId: string
  startedAt: number
  totalLaps: number
}

export interface RaceCheckpointPassRequest {
  roomId: string
  checkpointIndex: number
  lap: number
  timestamp: number
  position: [number, number, number]
}

export interface RaceParticipantProgress {
  playerId: string
  playerName: string
  color?: number
  currentLap: number
  checkpointIndex: number
  totalLaps: number
  rank: number
  finished: boolean
  finishTime: number | null
  bestLapTime: number | null
  currentLapTime: number
}

export interface RaceProgressPayload {
  roomId: string
  serverTime: number
  participants: RaceParticipantProgress[]
}

export interface RaceParticipantResult {
  rank: number
  playerId: string
  playerName: string
  color?: number
  totalTime: number
  bestLapTime: number | null
  lapTimes: number[]
  dnf?: boolean
}

export interface RaceResultsPayload {
  roomId: string
  results: RaceParticipantResult[]
}
