import type { Server, Socket } from 'socket.io'
import {
  OnlineRaceState,
  SOCKET_EVENTS,
  DEFAULT_RACE_ROOM_ID,
} from '../../../shared/src/constants.ts'
import type {
  PlayerInfo,
  RoomInfo,
  RaceParticipantProgress,
  RaceParticipantResult,
  RaceRoomUpdatePayload,
  RaceStartCountdownPayload,
  RaceStartedPayload,
  RaceProgressPayload,
  RaceResultsPayload,
} from '../../../shared/src/messages.ts'
import type { LeaderboardManager } from '../leaderboard/LeaderboardManager.ts'

export interface TrackCheckpointDef {
  id: number
  name: string
  x: number
  z: number
  radius: number
}

export interface GridSlotDef {
  index: number
  position: [number, number, number]
  rotation: [number, number, number, number]
}

export interface RacerProgress {
  playerId: string
  playerName: string
  gridIndex: number
  color?: number
  isReady: boolean
  currentLap: number
  nextCheckpointIndex: number
  lapStartTime: number
  lapTimes: number[]
  bestLapTime: number | null
  finishTime: number | null
  rank: number | null
  lastCheckpointTime: number
  finished: boolean
}

export interface ActiveRaceSession {
  roomId: string
  state: OnlineRaceState
  totalLaps: number
  countdownRemaining: number
  startTime: number
  countdownTimer?: NodeJS.Timeout
  finishGraceTimer?: NodeJS.Timeout
  racers: Map<string, RacerProgress>
  finishOrder: RaceParticipantResult[]
}

export class OnlineRaceManager {
  private io: Server
  private leaderboardManager?: LeaderboardManager
  private sessions = new Map<string, ActiveRaceSession>()

  // Circuit Checkpoints centered at Z = 600 (matches RaceTrack.ts)
  public static readonly CIRCUIT_CHECKPOINTS: TrackCheckpointDef[] = [
    { id: 0, name: 'Bitiş Çizgisi', x: 0, z: 555, radius: 24 },
    { id: 1, name: 'Şikan Çıkışı', x: 42, z: 678, radius: 28 },
    { id: 2, name: 'Arka Düzlük', x: 82, z: 615, radius: 28 },
    { id: 3, name: 'Viraj 3 (Hairpin)', x: 42, z: 504, radius: 28 },
    { id: 4, name: 'S-Virajları', x: -36, z: 555, radius: 28 },
    { id: 5, name: 'Son Viraj', x: -24, z: 642, radius: 28 },
  ]

  // Starting Grid Slots (Staggered along main straight Z = 570 down to 521)
  public static readonly GRID_SLOTS: GridSlotDef[] = [
    { index: 0, position: [2.5, 0.45, 570], rotation: [0, 0, 0, 1] },
    { index: 1, position: [-2.5, 0.45, 563], rotation: [0, 0, 0, 1] },
    { index: 2, position: [2.5, 0.45, 556], rotation: [0, 0, 0, 1] },
    { index: 3, position: [-2.5, 0.45, 549], rotation: [0, 0, 0, 1] },
    { index: 4, position: [2.5, 0.45, 542], rotation: [0, 0, 0, 1] },
    { index: 5, position: [-2.5, 0.45, 535], rotation: [0, 0, 0, 1] },
    { index: 6, position: [2.5, 0.45, 528], rotation: [0, 0, 0, 1] },
    { index: 7, position: [-2.5, 0.45, 521], rotation: [0, 0, 0, 1] },
  ]

  constructor(io: Server, leaderboardManager?: LeaderboardManager) {
    this.io = io
    this.leaderboardManager = leaderboardManager
  }

  public setLeaderboardManager(lm: LeaderboardManager): void {
    this.leaderboardManager = lm
  }

  public getOrCreateSession(room: RoomInfo): ActiveRaceSession {
    let session = this.sessions.get(room.id)
    if (!session) {
      session = {
        roomId: room.id,
        state: OnlineRaceState.LOBBY,
        totalLaps: 2,
        countdownRemaining: 0,
        startTime: 0,
        racers: new Map(),
        finishOrder: [],
      }
      this.sessions.set(room.id, session)

      // Initialize existing players into session
      room.players.forEach((p, idx) => {
        this.addRacerToSession(session!, p, idx)
      })
    }
    return session
  }

  public getSession(roomId: string): ActiveRaceSession | undefined {
    return this.sessions.get(roomId)
  }

  public handlePlayerJoined(room: RoomInfo, player: PlayerInfo): void {
    if (room.mode !== 'RACE') return
    const session = this.getOrCreateSession(room)
    const gridIndex = session.racers.size % OnlineRaceManager.GRID_SLOTS.length
    this.addRacerToSession(session, player, gridIndex)
    this.broadcastRoomUpdate(room)
  }

  public handlePlayerLeft(room: RoomInfo, playerId: string): void {
    const session = this.sessions.get(room.id)
    if (!session) return

    session.racers.delete(playerId)

    // Recheck start condition if in lobby
    if (session.state === OnlineRaceState.LOBBY) {
      this.checkStartCondition(room)
    } else if (session.state === OnlineRaceState.RACING) {
      // Check if all remaining racers finished
      const unfinished = Array.from(session.racers.values()).filter((r) => !r.finished)
      if (unfinished.length === 0) {
        this.finishRace(room)
      } else {
        this.broadcastProgress(room)
      }
    }

    this.broadcastRoomUpdate(room)
  }

  public toggleReady(room: RoomInfo, playerId: string, isReady: boolean): void {
    const session = this.getOrCreateSession(room)
    if (session.state !== OnlineRaceState.LOBBY) return

    const racer = session.racers.get(playerId)
    if (racer) {
      racer.isReady = isReady
      // Sync into room.players
      const p = room.players.find((item) => item.id === playerId)
      if (p) p.isReady = isReady
    }

    this.broadcastRoomUpdate(room)
    this.checkStartCondition(room)
  }

  public checkStartCondition(room: RoomInfo): void {
    const session = this.sessions.get(room.id)
    if (!session || session.state !== OnlineRaceState.LOBBY) return

    const racers = Array.from(session.racers.values())
    if (racers.length === 0) return

    // All active players must be ready, minimum 1 player (allows solo test or 2+ racers)
    const allReady = racers.every((r) => r.isReady)
    if (allReady) {
      this.startCountdown(room)
    }
  }

  public startCountdown(room: RoomInfo): void {
    const session = this.getOrCreateSession(room)
    if (session.state !== OnlineRaceState.LOBBY) return

    session.state = OnlineRaceState.COUNTDOWN
    session.countdownRemaining = 3
    room.raceState = OnlineRaceState.COUNTDOWN

    const countdownPayload: RaceStartCountdownPayload = {
      roomId: room.id,
      countdownSeconds: 3,
      startsAt: Date.now() + 3000,
    }
    this.io.to(room.id).emit(SOCKET_EVENTS.RACE_START_COUNTDOWN, countdownPayload)
    this.broadcastRoomUpdate(room)

    if (session.countdownTimer) clearInterval(session.countdownTimer)

    session.countdownTimer = setInterval(() => {
      session.countdownRemaining--
      if (session.countdownRemaining <= 0) {
        if (session.countdownTimer) clearInterval(session.countdownTimer)
        session.countdownTimer = undefined
        this.startRace(room)
      } else {
        this.broadcastRoomUpdate(room)
      }
    }, 1000)
  }

  public startRace(room: RoomInfo): void {
    const session = this.getOrCreateSession(room)
    session.state = OnlineRaceState.RACING
    session.startTime = Date.now()
    session.finishOrder = []
    room.raceState = OnlineRaceState.RACING
    room.raceStartTime = session.startTime

    // Reset all racers for race start
    session.racers.forEach((racer) => {
      racer.currentLap = 1
      racer.nextCheckpointIndex = 1 // Must hit checkpoint 1 first
      racer.lapStartTime = session.startTime
      racer.lapTimes = []
      racer.bestLapTime = null
      racer.finishTime = null
      racer.rank = null
      racer.lastCheckpointTime = session.startTime
      racer.finished = false
    })

    const startedPayload: RaceStartedPayload = {
      roomId: room.id,
      startedAt: session.startTime,
      totalLaps: session.totalLaps,
    }
    this.io.to(room.id).emit(SOCKET_EVENTS.RACE_STARTED, startedPayload)
    this.broadcastRoomUpdate(room)
    this.broadcastProgress(room)
  }

  public handleCheckpointPass(
    room: RoomInfo,
    playerId: string,
    checkpointIndex: number,
    lap: number,
    position: [number, number, number]
  ): boolean {
    const session = this.sessions.get(room.id)
    if (!session || session.state !== OnlineRaceState.RACING) return false

    const racer = session.racers.get(playerId)
    if (!racer || racer.finished) return false

    // 1. Must hit the expected sequential checkpoint
    if (checkpointIndex !== racer.nextCheckpointIndex) {
      return false
    }

    const targetCp = OnlineRaceManager.CIRCUIT_CHECKPOINTS[checkpointIndex]
    if (!targetCp) return false

    // 2. Spatial validation: player position must be near the target checkpoint
    const dx = position[0] - targetCp.x
    const dz = position[2] - targetCp.z
    const dist = Math.hypot(dx, dz)
    const maxAllowedDist = targetCp.radius + 15.0 // Generous tolerance for latency / wide lines

    if (dist > maxAllowedDist) {
      return false
    }

    // 3. Minimum time validation (anti-teleport: at least 700ms between checkpoints)
    const now = Date.now()
    if (now - racer.lastCheckpointTime < 700) {
      return false
    }
    racer.lastCheckpointTime = now

    // 4. Progress update
    if (checkpointIndex === 0) {
      // Completed full lap
      const lapTime = (now - racer.lapStartTime) / 1000
      racer.lapTimes.push(lapTime)

      if (racer.bestLapTime === null || lapTime < racer.bestLapTime) {
        racer.bestLapTime = lapTime
      }

      if (this.leaderboardManager && lapTime >= 10.0) {
        this.leaderboardManager.recordRecord(
          'fastest_lap',
          racer.playerId,
          racer.playerName,
          'car-sedan',
          'Pist Yarışçısı',
          lapTime,
          'circuit'
        )
      }

      if (racer.currentLap < session.totalLaps) {
        racer.currentLap++
        racer.nextCheckpointIndex = 1
        racer.lapStartTime = now
      } else {
        // FINISHED ALL LAPS!
        racer.finished = true
        racer.finishTime = (now - session.startTime) / 1000
        const finishRank = session.finishOrder.length + 1
        racer.rank = finishRank

        const result: RaceParticipantResult = {
          rank: finishRank,
          playerId: racer.playerId,
          playerName: racer.playerName,
          color: racer.color,
          totalTime: racer.finishTime,
          bestLapTime: racer.bestLapTime,
          lapTimes: [...racer.lapTimes],
          dnf: false,
        }
        session.finishOrder.push(result)

        this.io.to(room.id).emit(SOCKET_EVENTS.RACE_PLAYER_FINISHED, result)

        // Check if all racers finished
        const unfinished = Array.from(session.racers.values()).filter((r) => !r.finished)
        if (unfinished.length === 0) {
          this.finishRace(room)
        } else if (!session.finishGraceTimer) {
          // Start 15s grace timer for remaining racers once winner crosses line
          session.finishGraceTimer = setTimeout(() => {
            this.finishRace(room)
          }, 15000)
        }
      }
    } else {
      // Intermediate checkpoint
      racer.nextCheckpointIndex = (checkpointIndex + 1) % OnlineRaceManager.CIRCUIT_CHECKPOINTS.length
    }

    this.broadcastProgress(room)
    return true
  }

  public finishRace(room: RoomInfo): void {
    const session = this.sessions.get(room.id)
    if (!session || session.state === OnlineRaceState.FINISHED) return

    if (session.finishGraceTimer) {
      clearTimeout(session.finishGraceTimer)
      session.finishGraceTimer = undefined
    }

    session.state = OnlineRaceState.FINISHED
    room.raceState = OnlineRaceState.FINISHED

    // Add remaining unfinished racers as DNF
    session.racers.forEach((racer) => {
      if (!racer.finished) {
        const dnfRank = session.finishOrder.length + 1
        racer.rank = dnfRank
        const dnfResult: RaceParticipantResult = {
          rank: dnfRank,
          playerId: racer.playerId,
          playerName: racer.playerName,
          color: racer.color,
          totalTime: (Date.now() - session.startTime) / 1000,
          bestLapTime: racer.bestLapTime,
          lapTimes: [...racer.lapTimes],
          dnf: true,
        }
        session.finishOrder.push(dnfResult)
      }
    })

    const payload: RaceResultsPayload = {
      roomId: room.id,
      results: session.finishOrder,
    }
    this.io.to(room.id).emit(SOCKET_EVENTS.RACE_RESULTS, payload)
    this.broadcastRoomUpdate(room)
  }

  public rematch(room: RoomInfo): void {
    const session = this.sessions.get(room.id)
    if (!session) return

    if (session.countdownTimer) clearTimeout(session.countdownTimer)
    if (session.finishGraceTimer) clearTimeout(session.finishGraceTimer)

    session.state = OnlineRaceState.LOBBY
    session.countdownRemaining = 0
    session.finishOrder = []
    room.raceState = OnlineRaceState.LOBBY

    // Reset all racers to unready
    session.racers.forEach((racer) => {
      racer.isReady = false
      racer.currentLap = 1
      racer.nextCheckpointIndex = 1
      racer.finished = false
      racer.finishTime = null
      racer.rank = null
      racer.lapTimes = []
      racer.bestLapTime = null
    })

    room.players.forEach((p) => {
      p.isReady = false
    })

    this.io.to(room.id).emit(SOCKET_EVENTS.RACE_REMATCH, { roomId: room.id })
    this.broadcastRoomUpdate(room)
  }

  public broadcastRoomUpdate(room: RoomInfo): void {
    const session = this.sessions.get(room.id)
    const updatePayload: RaceRoomUpdatePayload = {
      roomId: room.id,
      raceState: session ? session.state : OnlineRaceState.LOBBY,
      players: room.players,
      countdownRemaining: session ? session.countdownRemaining : 0,
      startTime: session ? session.startTime : 0,
      totalLaps: session ? session.totalLaps : 2,
    }
    this.io.to(room.id).emit(SOCKET_EVENTS.RACE_ROOM_UPDATE, updatePayload)
  }

  public broadcastProgress(room: RoomInfo): void {
    const session = this.sessions.get(room.id)
    if (!session) return

    const now = Date.now()
    const racers = Array.from(session.racers.values())

    // Sort to calculate live ranks
    // Finished racers first by rank, then active racers by (lap desc, cp desc, lapTime asc)
    racers.sort((a, b) => {
      if (a.finished && b.finished) return (a.rank || 0) - (b.rank || 0)
      if (a.finished) return -1
      if (b.finished) return 1
      if (a.currentLap !== b.currentLap) return b.currentLap - a.currentLap
      if (a.nextCheckpointIndex !== b.nextCheckpointIndex) return b.nextCheckpointIndex - a.nextCheckpointIndex
      return a.lapStartTime - b.lapStartTime
    })

    const participants: RaceParticipantProgress[] = racers.map((r, index) => {
      const liveRank = r.finished ? (r.rank || index + 1) : index + 1
      return {
        playerId: r.playerId,
        playerName: r.playerName,
        color: r.color,
        currentLap: r.currentLap,
        checkpointIndex: r.nextCheckpointIndex,
        totalLaps: session.totalLaps,
        rank: liveRank,
        finished: r.finished,
        finishTime: r.finishTime,
        bestLapTime: r.bestLapTime,
        currentLapTime: r.finished ? (r.finishTime || 0) : Math.max(0, (now - r.lapStartTime) / 1000),
      }
    })

    const progressPayload: RaceProgressPayload = {
      roomId: room.id,
      serverTime: now,
      participants,
    }
    this.io.to(room.id).emit(SOCKET_EVENTS.RACE_PLAYER_PROGRESS, progressPayload)
  }

  private addRacerToSession(session: ActiveRaceSession, player: PlayerInfo, gridIndex: number): void {
    player.gridIndex = gridIndex
    player.isReady = false
    session.racers.set(player.id, {
      playerId: player.id,
      playerName: player.name,
      gridIndex,
      color: player.color,
      isReady: false,
      currentLap: 1,
      nextCheckpointIndex: 1,
      lapStartTime: 0,
      lapTimes: [],
      bestLapTime: null,
      finishTime: null,
      rank: null,
      lastCheckpointTime: 0,
      finished: false,
    })
  }
}
