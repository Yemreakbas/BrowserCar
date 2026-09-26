import type { OnlineRaceState, OnlineDriftState } from './constants.ts'

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
  driftState?: OnlineDriftState
  driftStartTime?: number
  driftSessionDuration?: number
  roomCode?: string
  isPrivate?: boolean
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
  isPrivate?: boolean
  roomCode?: string
}

export interface JoinRoomRequest {
  roomId?: string
  roomCode?: string
  playerName?: string
}

export interface QuickJoinRequest {
  preferredMode?: string
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

export interface PlayerResetRequest {
  roomId: string
  position: [number, number, number]
  rotation: [number, number, number, number]
  reason: 'manual' | 'fall' | 'flipped' | 'stuck'
}

export interface PlayerResetResponse {
  success: boolean
  position: [number, number, number]
  rotation: [number, number, number, number]
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

// --- ONLINE DRIFT PAYLOADS (PHASE 17) ---

export interface DriftRoomUpdatePayload {
  roomId: string
  driftState: OnlineDriftState
  players: PlayerInfo[]
  countdownRemaining?: number
  remainingSeconds?: number
  sessionDuration?: number
}

export interface DriftStartCountdownPayload {
  roomId: string
  countdownSeconds: number
  startsAt: number
}

export interface DriftStartedPayload {
  roomId: string
  startedAt: number
  sessionDuration: number
}

export interface DriftScoreSubmission {
  roomId: string
  slipAngleDeg: number
  speedKmh: number
  duration: number
  pointsDelta: number
  zoneBonus: number
  comboMultiplier: number
  isSpinOut?: boolean
  banked?: boolean
  timestamp: number
}

export interface DriftParticipantProgress {
  playerId: string
  playerName: string
  color?: number
  totalScore: number
  currentPoints: number
  comboMultiplier: number
  bestDriftScore: number
  isDrifting: boolean
  rank: number
}

export interface DriftLeaderboardPayload {
  roomId: string
  driftState: OnlineDriftState
  remainingSeconds: number
  leaderboard: DriftParticipantProgress[]
}

export interface DriftSessionFinishedPayload {
  roomId: string
  leaderboard: DriftParticipantProgress[]
  winner: DriftParticipantProgress | null
}

// --- LEADERBOARDS (PHASE 25) ---
export type LeaderboardCategory = 'fastest_lap' | 'best_drift_score' | 'best_drift_combo' | 'city_top_speed'

export interface LeaderboardEntry {
  id: string
  category: LeaderboardCategory
  playerId: string
  playerName: string
  carId: string
  carName: string
  score: number // lap time in sec (lower is better), or drift score (higher is better), or combo (higher is better), or top speed km/h (higher is better)
  formattedScore: string
  trackId?: string
  date: number
  rank?: number
}

export interface LeaderboardDataPayload {
  category: LeaderboardCategory
  entries: LeaderboardEntry[]
  userRank?: {
    rank: number
    entry: LeaderboardEntry
  } | null
  updatedAt: number
}

export interface LeaderboardAllPayload {
  fastest_lap: LeaderboardEntry[]
  best_drift_score: LeaderboardEntry[]
  best_drift_combo: LeaderboardEntry[]
  city_top_speed: LeaderboardEntry[]
  updatedAt: number
}

export interface LeaderboardSubmitRequest {
  category: LeaderboardCategory
  score: number
  carId?: string
  carName?: string
  trackId?: string
}

export interface LeaderboardSubmitResponse {
  success: boolean
  rank?: number
  isNewBest?: boolean
  error?: string
}
