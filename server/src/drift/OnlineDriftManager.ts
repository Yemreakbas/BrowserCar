import type { Server, Socket } from 'socket.io'
import {
  OnlineDriftState,
  SOCKET_EVENTS,
  DEFAULT_DRIFT_ROOM_ID,
} from '../../../shared/src/constants.ts'
import type {
  PlayerInfo,
  RoomInfo,
  DriftRoomUpdatePayload,
  DriftStartCountdownPayload,
  DriftStartedPayload,
  DriftScoreSubmission,
  DriftParticipantProgress,
  DriftLeaderboardPayload,
  DriftSessionFinishedPayload,
} from '../../../shared/src/messages.ts'

export interface DrifterProgress {
  playerId: string
  playerName: string
  color?: number
  isReady: boolean
  totalScore: number
  currentPoints: number
  comboMultiplier: number
  bestDriftScore: number
  isDrifting: boolean
  rank: number
  lastSubmissionTime: number
  lastBankedTime: number
  consecutiveSubmissions: number
}

export interface ActiveDriftSession {
  roomId: string
  state: OnlineDriftState
  sessionDuration: number // 60 seconds standard session
  remainingSeconds: number
  countdownRemaining: number
  startTime: number
  countdownTimer?: NodeJS.Timeout
  tickTimer?: NodeJS.Timeout
  drifters: Map<string, DrifterProgress>
}

export class OnlineDriftManager {
  private io: Server
  private sessions = new Map<string, ActiveDriftSession>()

  // Standard drift session duration in seconds
  public static readonly DEFAULT_SESSION_DURATION = 60
  public static readonly COUNTDOWN_SECONDS = 3

  constructor(io: Server) {
    this.io = io
  }

  public getOrCreateSession(room: RoomInfo): ActiveDriftSession {
    let session = this.sessions.get(room.id)
    if (!session) {
      session = {
        roomId: room.id,
        state: OnlineDriftState.LOBBY,
        sessionDuration: OnlineDriftManager.DEFAULT_SESSION_DURATION,
        remainingSeconds: OnlineDriftManager.DEFAULT_SESSION_DURATION,
        countdownRemaining: 0,
        startTime: 0,
        drifters: new Map(),
      }
      this.sessions.set(room.id, session)
    }

    // Synchronize drifters map with players currently in room
    for (const player of room.players) {
      if (!session.drifters.has(player.id)) {
        this.addPlayer(room.id, player)
      }
    }

    return session
  }

  public getSession(roomId: string): ActiveDriftSession | undefined {
    return this.sessions.get(roomId)
  }

  public addPlayer(roomId: string, player: PlayerInfo): void {
    let session = this.sessions.get(roomId)
    if (!session) return

    session.drifters.set(player.id, {
      playerId: player.id,
      playerName: player.name,
      color: player.color,
      isReady: !!player.isReady,
      totalScore: 0,
      currentPoints: 0,
      comboMultiplier: 1.0,
      bestDriftScore: 0,
      isDrifting: false,
      rank: session.drifters.size + 1,
      lastSubmissionTime: Date.now(),
      lastBankedTime: 0,
      consecutiveSubmissions: 0,
    })

    this.recalculateRanks(session)
    this.broadcastRoomUpdate(session)
  }

  public removePlayer(roomId: string, playerId: string): void {
    const session = this.sessions.get(roomId)
    if (!session) return

    session.drifters.delete(playerId)
    this.recalculateRanks(session)

    if (session.drifters.size === 0) {
      this.resetSession(session)
    } else {
      this.broadcastRoomUpdate(session)
      if (session.state === OnlineDriftState.ACTIVE) {
        this.broadcastLeaderboard(session)
      }
    }
  }

  public toggleReady(roomId: string, playerId: string): { started: boolean } {
    const session = this.sessions.get(roomId)
    if (!session) return { started: false }

    if (session.state !== OnlineDriftState.LOBBY) {
      return { started: false }
    }

    const drifter = session.drifters.get(playerId)
    if (!drifter) return { started: false }

    drifter.isReady = !drifter.isReady
    this.broadcastRoomUpdate(session)

    // Check if ready conditions are met (at least 2 players in multiplayer, or all players ready)
    const driftersList = Array.from(session.drifters.values())
    const totalCount = driftersList.length
    const readyCount = driftersList.filter(d => d.isReady).length

    // Start countdown if at least 1 player is present and 100% ready (or >= 2 players ready)
    if (totalCount > 0 && readyCount === totalCount) {
      this.startCountdown(session)
      return { started: true }
    }

    return { started: false }
  }

  public startCountdown(session: ActiveDriftSession): void {
    if (session.state !== OnlineDriftState.LOBBY) return

    session.state = OnlineDriftState.COUNTDOWN
    session.countdownRemaining = OnlineDriftManager.COUNTDOWN_SECONDS

    const payload: DriftStartCountdownPayload = {
      roomId: session.roomId,
      countdownSeconds: session.countdownRemaining,
      startsAt: Date.now() + session.countdownRemaining * 1000,
    }
    this.io.to(session.roomId).emit(SOCKET_EVENTS.DRIFT_START_COUNTDOWN, payload)
    this.broadcastRoomUpdate(session)

    if (session.countdownTimer) {
      clearInterval(session.countdownTimer)
    }

    session.countdownTimer = setInterval(() => {
      session.countdownRemaining--

      if (session.countdownRemaining > 0) {
        const tickPayload: DriftStartCountdownPayload = {
          roomId: session.roomId,
          countdownSeconds: session.countdownRemaining,
          startsAt: Date.now() + session.countdownRemaining * 1000,
        }
        this.io.to(session.roomId).emit(SOCKET_EVENTS.DRIFT_START_COUNTDOWN, tickPayload)
      } else {
        if (session.countdownTimer) {
          clearInterval(session.countdownTimer)
          session.countdownTimer = undefined
        }
        this.startDriftSession(session)
      }
    }, 1000)
  }

  public startDriftSession(session: ActiveDriftSession): void {
    session.state = OnlineDriftState.ACTIVE
    session.startTime = Date.now()
    session.remainingSeconds = session.sessionDuration

    // Reset all drifter session scores
    for (const drifter of session.drifters.values()) {
      drifter.totalScore = 0
      drifter.currentPoints = 0
      drifter.comboMultiplier = 1.0
      drifter.bestDriftScore = 0
      drifter.isDrifting = false
      drifter.lastSubmissionTime = Date.now()
    }

    this.recalculateRanks(session)

    const startPayload: DriftStartedPayload = {
      roomId: session.roomId,
      startedAt: session.startTime,
      sessionDuration: session.sessionDuration,
    }
    this.io.to(session.roomId).emit(SOCKET_EVENTS.DRIFT_STARTED, startPayload)
    this.broadcastRoomUpdate(session)
    this.broadcastLeaderboard(session)

    // Start 1-second server tick for session duration
    if (session.tickTimer) {
      clearInterval(session.tickTimer)
    }

    session.tickTimer = setInterval(() => {
      session.remainingSeconds--
      this.broadcastLeaderboard(session)

      if (session.remainingSeconds <= 0) {
        if (session.tickTimer) {
          clearInterval(session.tickTimer)
          session.tickTimer = undefined
        }
        this.finishSession(session)
      }
    }, 1000)
  }

  /**
   * Process and validate incoming drift scoring event.
   * Do not trust arbitrary client scores - enforce server sanity boundaries.
   */
  public processScoreSubmission(playerId: string, sub: DriftScoreSubmission): boolean {
    const session = this.sessions.get(sub.roomId)
    if (!session || session.state !== OnlineDriftState.ACTIVE) {
      return false
    }

    const drifter = session.drifters.get(playerId)
    if (!drifter) {
      return false
    }

    const now = Date.now()
    const dt = Math.max((now - drifter.lastSubmissionTime) / 1000, 0.04)
    drifter.lastSubmissionTime = now

    // 1. Sanity check: is spin-out?
    if (sub.isSpinOut) {
      drifter.currentPoints = 0
      drifter.comboMultiplier = 1.0
      drifter.isDrifting = false
      this.recalculateRanks(session)
      return true
    }

    // 2. Sanity check: Banked points
    if (sub.banked) {
      const bankedAmount = Math.max(0, Math.round(sub.pointsDelta || drifter.currentPoints))
      
      // Maximum single bank sanity limit: 150,000 points
      const validatedBank = Math.min(bankedAmount, 150000)
      drifter.totalScore += validatedBank
      if (validatedBank > drifter.bestDriftScore) {
        drifter.bestDriftScore = validatedBank
      }
      drifter.currentPoints = 0
      drifter.comboMultiplier = 1.0
      drifter.isDrifting = false
      drifter.lastBankedTime = now

      this.recalculateRanks(session)
      this.broadcastLeaderboard(session)
      return true
    }

    // 3. Active Drift Sanity Validation
    // Plausibility bounds:
    // Speed: 10 - 250 km/h
    // Angle: 8 - 85 deg
    // Zone bonus: 1.0 - 2.5
    // Multiplier: 1.0 - 5.0
    const validSpeed = sub.speedKmh >= 8 && sub.speedKmh <= 260
    const validAngle = sub.slipAngleDeg >= 7 && sub.slipAngleDeg <= 88
    const validZone = sub.zoneBonus >= 0.9 && sub.zoneBonus <= 2.6

    if (!validSpeed || !validAngle || !validZone) {
      // Discard unrealistic telemetry frame
      return false
    }

    // Max theoretical rate: 160 base * 2.5 maxAngle * 2.2 maxSpeed * 2.5 maxZone * 5.0 maxCombo = 11,000 pts/sec
    const maxTheoreticalRate = 11000
    const maxAllowedPoints = Math.round(maxTheoreticalRate * 1.35 * dt) + 50

    // Clamp reported points delta to physical maximum
    const clampedPointsDelta = Math.min(Math.max(0, sub.pointsDelta), maxAllowedPoints)

    // Clamp combo multiplier based on reported continuous duration
    const maxAllowedCombo =
      sub.duration >= 8.0 ? 5.0 :
      sub.duration >= 6.0 ? 4.0 :
      sub.duration >= 4.0 ? 3.0 :
      sub.duration >= 2.5 ? 2.5 :
      sub.duration >= 1.5 ? 2.0 :
      sub.duration >= 0.8 ? 1.5 : 1.0

    drifter.isDrifting = true
    drifter.currentPoints += clampedPointsDelta
    drifter.comboMultiplier = Math.min(Math.max(1.0, sub.comboMultiplier), maxAllowedCombo)

    this.recalculateRanks(session)
    return true
  }

  public finishSession(session: ActiveDriftSession): void {
    session.state = OnlineDriftState.FINISHED
    session.remainingSeconds = 0

    // Bank any active drifting points at session cutoff
    for (const drifter of session.drifters.values()) {
      if (drifter.currentPoints > 0) {
        drifter.totalScore += Math.round(drifter.currentPoints)
        if (drifter.currentPoints > drifter.bestDriftScore) {
          drifter.bestDriftScore = Math.round(drifter.currentPoints)
        }
        drifter.currentPoints = 0
        drifter.isDrifting = false
      }
    }

    this.recalculateRanks(session)

    const leaderboard = this.getLeaderboard(session)
    const winner = leaderboard.length > 0 ? leaderboard[0] : null

    const finishPayload: DriftSessionFinishedPayload = {
      roomId: session.roomId,
      leaderboard,
      winner,
    }

    this.io.to(session.roomId).emit(SOCKET_EVENTS.DRIFT_SESSION_FINISHED, finishPayload)
    this.broadcastRoomUpdate(session)
  }

  public rematch(roomId: string): void {
    const session = this.sessions.get(roomId)
    if (!session) return

    this.resetSession(session)
    this.io.to(session.roomId).emit(SOCKET_EVENTS.DRIFT_REMATCH, { roomId })
    this.broadcastRoomUpdate(session)
  }

  public resetSession(session: ActiveDriftSession): void {
    if (session.countdownTimer) {
      clearInterval(session.countdownTimer)
      session.countdownTimer = undefined
    }
    if (session.tickTimer) {
      clearInterval(session.tickTimer)
      session.tickTimer = undefined
    }

    session.state = OnlineDriftState.LOBBY
    session.countdownRemaining = 0
    session.remainingSeconds = session.sessionDuration
    session.startTime = 0

    for (const drifter of session.drifters.values()) {
      drifter.isReady = false
      drifter.totalScore = 0
      drifter.currentPoints = 0
      drifter.comboMultiplier = 1.0
      drifter.bestDriftScore = 0
      drifter.isDrifting = false
      drifter.rank = 1
    }

    this.recalculateRanks(session)
  }

  private recalculateRanks(session: ActiveDriftSession): void {
    const drifters = Array.from(session.drifters.values())

    // Sort primarily by totalScore descending, then by bestDriftScore descending
    drifters.sort((a, b) => {
      const aEffective = a.totalScore + a.currentPoints
      const bEffective = b.totalScore + b.currentPoints
      if (bEffective !== aEffective) {
        return bEffective - aEffective
      }
      return b.bestDriftScore - a.bestDriftScore
    })

    drifters.forEach((d, idx) => {
      d.rank = idx + 1
    })
  }

  public getLeaderboard(session: ActiveDriftSession): DriftParticipantProgress[] {
    const drifters = Array.from(session.drifters.values())
    drifters.sort((a, b) => a.rank - b.rank)

    return drifters.map(d => ({
      playerId: d.playerId,
      playerName: d.playerName,
      color: d.color,
      totalScore: d.totalScore,
      currentPoints: d.currentPoints,
      comboMultiplier: d.comboMultiplier,
      bestDriftScore: d.bestDriftScore,
      isDrifting: d.isDrifting,
      rank: d.rank,
    }))
  }

  public broadcastLeaderboard(session: ActiveDriftSession): void {
    const payload: DriftLeaderboardPayload = {
      roomId: session.roomId,
      driftState: session.state,
      remainingSeconds: session.remainingSeconds,
      leaderboard: this.getLeaderboard(session),
    }

    this.io.to(session.roomId).emit(SOCKET_EVENTS.DRIFT_LEADERBOARD_UPDATE, payload)
  }

  public broadcastRoomUpdate(session: ActiveDriftSession): void {
    const players: PlayerInfo[] = Array.from(session.drifters.values()).map(d => ({
      id: d.playerId,
      name: d.playerName,
      color: d.color,
      isReady: d.isReady,
      connectedAt: 0,
    }))

    const payload: DriftRoomUpdatePayload = {
      roomId: session.roomId,
      driftState: session.state,
      players,
      countdownRemaining: session.countdownRemaining,
      remainingSeconds: session.remainingSeconds,
      sessionDuration: session.sessionDuration,
    }

    this.io.to(session.roomId).emit(SOCKET_EVENTS.DRIFT_ROOM_UPDATE, payload)
  }
}
