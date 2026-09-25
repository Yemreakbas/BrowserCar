import * as THREE from 'three'
import { type IGameMode, GameModeType, MapType, type ModeContext } from './types.ts'
import { DriftSystem } from '../drift/DriftSystem.ts'
import { OnlineDriftState, DEFAULT_DRIFT_ROOM_ID } from '../../shared/src/constants.ts'
import type {
  DriftLeaderboardPayload,
  DriftRoomUpdatePayload,
  DriftScoreSubmission,
  DriftSessionFinishedPayload,
  DriftStartCountdownPayload,
  DriftStartedPayload,
} from '../../shared/src/messages.ts'

export class DriftMode implements IGameMode {
  public readonly modeType = GameModeType.DRIFT
  public readonly mapType = MapType.DRIFT_TRACK
  public readonly title = 'Drift & Slalom Parkuru'
  public readonly subtitle = 'Özel Drift Arenası & Çevrimiçi Seans'
  public readonly description = 'Geniş asfalt pist, Omega virajı, Donut drift meydanı, S-şikanlar ve canlı çok oyunculu drift mücadelesi.'
  public readonly icon = '⚡'
  public readonly badgeColor = '#f59e0b'

  public currentSpawnIndex: number = 0
  private driftSystem = new DriftSystem()
  private smokeTimer = 0
  private tempWheelL = new THREE.Vector3()
  private tempWheelR = new THREE.Vector3()
  private tempCarVel = new THREE.Vector3()

  // Online Multiplayer State
  public isOnlineSession = false
  public localReady = false
  public currentDriftState: OnlineDriftState = OnlineDriftState.LOBBY
  private cleanupFns: Array<() => void> = []
  private resultsShown = false
  private scoreSubmitTimer = 0
  private lastSentCurrentPoints = 0
  private lastBankedScore = 0
  private lastReportedSpinOut = false

  public onEnter(context: ModeContext): void {
    context.cityWorld.group.visible = false
    context.raceTrack.setVisible(false)
    context.driftTrack.setVisible(true)

    context.hud.setTelemetryVisible(false)
    context.hud.setSpawnButtonVisible(true)
    context.hud.setDriftCardVisible(true)
    context.hud.hideDriftResults?.()

    this.resultsShown = false
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []

    this.driftSystem.reset()
    this.applySpawn(context, this.currentSpawnIndex)

    const net = context.networkManager
    const isOnline = !!(net && net.isConnected())
    const currentRoom = net?.getCurrentRoom()

    // Auto-join permanent drift arena room if online and currently in another room
    if (isOnline && (!currentRoom || currentRoom.mode !== 'DRIFT')) {
      net.joinRoom(DEFAULT_DRIFT_ROOM_ID, net.getPlayerName() || undefined).catch((err) => {
        console.warn('[DriftMode] Auto-join drift arena failed:', err)
      })
    }

    this.checkAndInitSession(context)

    if (net) {
      this.cleanupFns.push(
        net.onRoomJoined((payload) => {
          if (payload.room.mode === 'DRIFT') {
            this.checkAndInitSession(context)
          }
        }),
        net.onDriftRoomUpdate((payload) => {
          this.handleRoomUpdate(payload, context)
        }),
        net.onDriftCountdown((payload) => {
          this.handleServerCountdown(payload, context)
        }),
        net.onDriftStarted((payload) => {
          this.handleServerStarted(payload, context)
        }),
        net.onDriftLeaderboard((payload) => {
          this.handleServerLeaderboard(payload, context)
        }),
        net.onDriftSessionFinished((payload) => {
          this.handleServerFinished(payload, context)
        }),
        net.onDriftRematch(() => {
          this.handleServerRematch(context)
        })
      )
    }
  }

  public checkAndInitSession(context: ModeContext): void {
    const net = context.networkManager
    const currentRoom = net?.getCurrentRoom()
    const isOnlineDrift = !!(net && net.isConnected() && currentRoom && currentRoom.mode === 'DRIFT')

    this.isOnlineSession = isOnlineDrift

    if (isOnlineDrift) {
      context.hud.setSubtitle('Çevrimiçi Drift Arenası • Başlamak İçin Hazır Ol', this.badgeColor)
      this.localReady = false
      this.currentDriftState = currentRoom.driftState || OnlineDriftState.LOBBY
      this.driftSystem.reset()
      this.applySpawn(context, this.currentSpawnIndex)
    } else {
      this.currentDriftState = OnlineDriftState.LOBBY
    }
  }

  public toggleReady(context: ModeContext): void {
    if (!this.isOnlineSession || !context.networkManager) return
    context.networkManager.sendDriftReadyToggle()
    this.localReady = !this.localReady
  }

  public onUpdate(delta: number, context: ModeContext): void {
    // 1. Check if vehicle is inside any dedicated Drift Zone
    const { activeZone, bonusMultiplier } = context.driftTrack.update(delta, context.vehicle.root.position)

    // Lock car controls during countdown or when finished in online mode
    if (this.isOnlineSession) {
      if (this.currentDriftState === OnlineDriftState.COUNTDOWN) {
        context.vehicle.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
        context.vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
      } else if (this.currentDriftState === OnlineDriftState.FINISHED) {
        context.vehicle.currentSpeed = 0
        context.vehicle.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
        context.vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
        context.vehicle.isHandbrakeActive = true
      }
    }

    // 2. Update Drift Scoring Engine with Zone Bonus
    const driftState = this.driftSystem.update(delta, context.vehicle, bonusMultiplier)

    // 3. Online Score Submission with Server-Side Validation
    if (this.isOnlineSession && this.currentDriftState === OnlineDriftState.ACTIVE && context.networkManager) {
      const net = context.networkManager
      const currentRoom = net.getCurrentRoom()

      if (currentRoom) {
        // A. Handle Spin-Out event
        if (driftState.isSpinOut) {
          if (!this.lastReportedSpinOut) {
            this.lastReportedSpinOut = true
            const sub: DriftScoreSubmission = {
              roomId: currentRoom.id,
              slipAngleDeg: driftState.driftAngleDeg,
              speedKmh: driftState.driftSpeedKmh,
              duration: 0,
              pointsDelta: 0,
              zoneBonus: 1.0,
              comboMultiplier: 1.0,
              isSpinOut: true,
              timestamp: Date.now(),
            }
            net.sendDriftScore(sub)
            this.lastSentCurrentPoints = 0
          }
        } else {
          this.lastReportedSpinOut = false

          // B. Handle Banked event
          if (driftState.lastBankedPoints > 0 && driftState.lastBankedPoints !== this.lastBankedScore) {
            this.lastBankedScore = driftState.lastBankedPoints
            const sub: DriftScoreSubmission = {
              roomId: currentRoom.id,
              slipAngleDeg: driftState.driftAngleDeg,
              speedKmh: driftState.driftSpeedKmh,
              duration: driftState.driftDuration,
              pointsDelta: driftState.lastBankedPoints,
              zoneBonus: bonusMultiplier,
              comboMultiplier: 1.0,
              banked: true,
              timestamp: Date.now(),
            }
            net.sendDriftScore(sub)
            this.lastSentCurrentPoints = 0
          }
          // C. Handle Active Continuous Drift frame updates (throttled at ~150ms)
          else if (driftState.isDrifting) {
            this.scoreSubmitTimer += delta
            if (this.scoreSubmitTimer >= 0.15) {
              this.scoreSubmitTimer = 0
              const pointsDelta = Math.max(0, driftState.currentPoints - this.lastSentCurrentPoints)
              this.lastSentCurrentPoints = driftState.currentPoints

              const sub: DriftScoreSubmission = {
                roomId: currentRoom.id,
                slipAngleDeg: driftState.driftAngleDeg,
                speedKmh: driftState.driftSpeedKmh,
                duration: driftState.driftDuration,
                pointsDelta,
                zoneBonus: bonusMultiplier,
                comboMultiplier: driftState.comboMultiplier,
                timestamp: Date.now(),
              }
              net.sendDriftScore(sub)
            }
          } else if (!driftState.isInComboWindow) {
            this.lastSentCurrentPoints = 0
          }
        }
      }
    }

    // 4. Emit Tire Smoke during drift slides or handbrake turns
    if (
      context.tireSmoke &&
      (driftState.isDrifting || (context.vehicle.isHandbrakeActive && Math.abs(context.vehicle.currentSpeed) > 3.0))
    ) {
      this.smokeTimer += delta
      if (this.smokeTimer >= 0.03) {
        this.smokeTimer = 0
        context.vehicle.getRearWheelPositions(this.tempWheelL, this.tempWheelR)
        const linvel = context.vehicle.rigidBody.linvel()
        this.tempCarVel.set(linvel.x, linvel.y, linvel.z)

        context.tireSmoke.emit(this.tempWheelL, this.tempCarVel)
        context.tireSmoke.emit(this.tempWheelR, this.tempCarVel)
      }
    }

    // 5. Format HUD Telemetry
    const scoreText =
      driftState.currentPoints > 0
        ? `${driftState.currentPoints.toLocaleString()} PUAN`
        : `${driftState.totalScore.toLocaleString()} TOPLAM`

    const comboText = `${driftState.comboMultiplier.toFixed(1)}x ${driftState.isDrifting ? '🔥' : ''}`
    const angleText = `${driftState.driftAngleDeg}° Açı`
    const totalText = `En İyi: ${driftState.bestDriftScore.toLocaleString()}`

    let statusLine = driftState.ratingText
    if (activeZone && driftState.isDrifting) {
      statusLine = `${activeZone.name} (${activeZone.multiplierBonus}x Bonus!)`
    }

    context.hud.updateDriftTelemetry(
      scoreText,
      comboText,
      statusLine,
      angleText,
      totalText,
      driftState.isDrifting
    )

    // Highlight subtitle if in active zone or achieving high combo
    if (activeZone && driftState.isDrifting) {
      context.hud.setSubtitle(`⚡ ${activeZone.name} • ${activeZone.multiplierBonus}x BONUS ⚡`, '#f59e0b')
    } else if (driftState.isDrifting && driftState.currentPoints >= 1000) {
      context.hud.setSubtitle(`★ ${driftState.ratingText} ★`, '#facc15')
    }
  }

  private handleRoomUpdate(payload: DriftRoomUpdatePayload, context: ModeContext): void {
    this.currentDriftState = payload.driftState

    const myId = context.networkManager?.getPlayerId()
    if (myId) {
      const me = payload.players.find((p) => p.id === myId)
      if (me) {
        this.localReady = !!me.isReady
      }
    }

    if (payload.driftState === OnlineDriftState.LOBBY) {
      context.hud.setSubtitle('Drift Lobisi • Başlamak İçin Hazır Ol', this.badgeColor)
    }
  }

  private handleServerCountdown(payload: DriftStartCountdownPayload, context: ModeContext): void {
    this.currentDriftState = OnlineDriftState.COUNTDOWN
    context.hud.setSubtitle('⏱️ GERİ SAYIM BAŞLADI!', '#f59e0b')
    context.hud.setDriftCountdown?.(payload.countdownSeconds.toString(), '#f59e0b')
  }

  private handleServerStarted(_payload: DriftStartedPayload, context: ModeContext): void {
    this.currentDriftState = OnlineDriftState.ACTIVE
    this.driftSystem.reset()
    this.resultsShown = false
    this.lastSentCurrentPoints = 0
    this.lastBankedScore = 0

    context.hud.setSubtitle('⚡ DRIFT BAŞLADI! YANLA!', '#22c55e')
    context.hud.setDriftCountdown?.('YANLA! ⚡', '#22c55e')

    setTimeout(() => {
      context.hud.setDriftCountdown?.(null)
    }, 1200)
  }

  private handleServerLeaderboard(payload: DriftLeaderboardPayload, context: ModeContext): void {
    this.currentDriftState = payload.driftState
    context.hud.updateDriftLeaderboard?.(payload.leaderboard, payload.remainingSeconds, payload.driftState)
  }

  private handleServerFinished(payload: DriftSessionFinishedPayload, context: ModeContext): void {
    if (this.resultsShown) return
    this.resultsShown = true
    this.currentDriftState = OnlineDriftState.FINISHED

    context.hud.setDriftCountdown?.(null)
    context.hud.showMultiplayerDriftResults?.(payload.leaderboard, payload.winner)
  }

  private handleServerRematch(context: ModeContext): void {
    this.currentDriftState = OnlineDriftState.LOBBY
    this.resultsShown = false
    this.localReady = false
    this.lastSentCurrentPoints = 0
    this.lastBankedScore = 0

    context.hud.hideDriftResults?.()
    this.driftSystem.reset()
    this.applySpawn(context, this.currentSpawnIndex)
    context.hud.setSubtitle('Drift Seansı Yenilendi • Tekrar Hazır Ol', this.badgeColor)
  }

  public onExit(context: ModeContext): void {
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
    context.hud.setDriftCountdown?.(null)
    context.hud.hideDriftResults?.()

    if (context.tireSmoke) {
      context.tireSmoke.reset()
    }
  }

  public onReset(context: ModeContext): void {
    this.driftSystem.reset()
    if (context.tireSmoke) {
      context.tireSmoke.reset()
    }
    this.applySpawn(context, this.currentSpawnIndex)
  }

  public cycleSpawn(context: ModeContext): void {
    const totalSpawns = context.driftTrack.spawnPoints.length
    this.currentSpawnIndex = (this.currentSpawnIndex + 1) % totalSpawns
    this.applySpawn(context, this.currentSpawnIndex)
  }

  private applySpawn(context: ModeContext, index: number): void {
    const totalSpawns = context.driftTrack.spawnPoints.length
    const spawn = context.driftTrack.getSpawnPosition(index)
    context.vehicle.reset(spawn.position.x, spawn.position.z, spawn.rotationY)

    context.hud.setSpawnText?.(`Konum ${index + 1}/${totalSpawns}`)
    context.hud.setSubtitle(`${spawn.name} • Drift Arenası`, '#f59e0b')
    context.hud.updateDriftTelemetry(
      '0 PUAN',
      '1.0x',
      'Hızlan, Viraja Gir ve Boşluk (El Freni) ile Kay!',
      '0°',
      'En İyi: 0',
      false
    )
  }

  public getDriftSystem(): DriftSystem {
    return this.driftSystem
  }
}
