import * as THREE from 'three'
import { type IGameMode, GameModeType, MapType, type ModeContext } from './types.ts'
import { RaceSystem, RaceState } from '../race/RaceSystem.ts'
import { OnlineRaceState, DEFAULT_RACE_ROOM_ID } from '../../shared/src/constants.ts'
import type { RaceParticipantResult, RaceProgressPayload, RaceResultsPayload, RaceRoomUpdatePayload, RaceStartCountdownPayload, RaceStartedPayload } from '../../shared/src/messages.ts'

export class RaceMode implements IGameMode {
  public readonly modeType = GameModeType.RACE
  public readonly mapType = MapType.RACE_TRACK
  public readonly title = 'Grand Prix Yarışı'
  public readonly subtitle = 'Kapalı Pist & Çevrimiçi Yarış Odası'
  public readonly description = 'Zorlu virajlar, şikanlar, apex kerbleri, kalkış gridi ve çok oyunculu Grand Prix mücadelesi.'
  public readonly icon = '🏁'
  public readonly badgeColor = '#ef4444'

  public static readonly GRID_POSITIONS = [
    { x: 2.5, y: 0.05, z: 570, rotY: 0 },
    { x: -2.5, y: 0.05, z: 563, rotY: 0 },
    { x: 2.5, y: 0.05, z: 556, rotY: 0 },
    { x: -2.5, y: 0.05, z: 549, rotY: 0 },
    { x: 2.5, y: 0.05, z: 542, rotY: 0 },
    { x: -2.5, y: 0.05, z: 535, rotY: 0 },
    { x: 2.5, y: 0.05, z: 528, rotY: 0 },
    { x: -2.5, y: 0.05, z: 521, rotY: 0 },
  ]

  private raceSystem = new RaceSystem()
  private resultsShown = false
  public isOnlineSession = false
  public localReady = false
  public assignedGridIndex = 0
  private cleanupFns: Array<() => void> = []

  // Checkpoint pass throttling & direction tracking
  private lastPassTime = 0
  private tempCarForward = new THREE.Vector3()
  private lastCountdownText: string | null = null

  public onEnter(context: ModeContext): void {
    context.cityWorld.group.visible = false
    context.raceTrack.setVisible(true)
    context.driftTrack.setVisible(false)

    context.hud.setTelemetryVisible(true)
    context.hud.setDriftCardVisible(false)
    context.hud.setSpawnButtonVisible(false)
    context.hud.hideRaceResults?.()
    context.hud.setWrongWayVisible?.(false)

    this.resultsShown = false
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []

    const net = context.networkManager
    const isOnline = !!(net && net.isConnected())
    const currentRoom = net?.getCurrentRoom()

    // Auto-join permanent race circuit room if online and currently in city room
    if (isOnline && (!currentRoom || currentRoom.mode !== 'RACE')) {
      net.joinRoom(DEFAULT_RACE_ROOM_ID, net.getPlayerName() || undefined).catch((err) => {
        console.warn('[RaceMode] Auto-join race circuit failed:', err)
      })
    }

    this.checkAndInitSession(context)

    if (net) {
      this.cleanupFns.push(
        net.onRoomJoined((payload) => {
          if (payload.room.mode === 'RACE') {
            this.checkAndInitSession(context)
          }
        }),
        net.onRaceRoomUpdate((payload) => {
          this.handleRoomUpdate(payload, context)
        }),
        net.onRaceCountdown((payload) => {
          this.handleServerCountdown(payload, context)
        }),
        net.onRaceStarted((payload) => {
          this.handleServerStarted(payload, context)
        }),
        net.onRaceProgress((payload) => {
          this.handleServerProgress(payload, context)
        }),
        net.onRacePlayerFinished((result) => {
          this.handlePlayerFinished(result, context)
        }),
        net.onRaceResults((payload) => {
          this.handleServerResults(payload, context)
        }),
        net.onRaceRematch(() => {
          this.handleServerRematch(context)
        })
      )
    }
  }

  public checkAndInitSession(context: ModeContext): void {
    const net = context.networkManager
    const currentRoom = net?.getCurrentRoom()
    const isOnlineRace = !!(net && net.isConnected() && currentRoom && currentRoom.mode === 'RACE')

    this.isOnlineSession = isOnlineRace

    if (isOnlineRace) {
      context.hud.setSubtitle('Çevrimiçi Yarış Odası • Başlamak İçin Hazır Ol', this.badgeColor)
      this.localReady = false
      this.resetToGrid(context)
      this.raceSystem.state = RaceState.PRE_RACE
      this.raceSystem.currentLap = 1
      this.raceSystem.nextCheckpointIndex = 1
      this.raceSystem.currentLapTime = 0
      this.raceSystem.lapTimes = []
    } else {
      context.hud.setSubtitle('Grand Prix • 3 Tur Mücadelesi', this.badgeColor)
      const pole = context.raceTrack.getPolePosition()
      context.vehicle.reset(pole.position.x, pole.position.z, pole.rotationY)
      this.raceSystem.startRace(context.raceTrack)
    }
  }

  public resetToGrid(context: ModeContext): void {
    const net = context.networkManager
    const currentRoom = net?.getCurrentRoom()
    const myId = net?.getPlayerId()

    let gridIndex = 0
    if (currentRoom && myId) {
      const p = currentRoom.players.find((item) => item.id === myId)
      if (p && p.gridIndex !== undefined) {
        gridIndex = p.gridIndex
      } else {
        const idx = currentRoom.players.findIndex((item) => item.id === myId)
        gridIndex = idx >= 0 ? idx % 8 : 0
      }
    }

    this.assignedGridIndex = gridIndex
    const slot = RaceMode.GRID_POSITIONS[gridIndex % RaceMode.GRID_POSITIONS.length]
    context.vehicle.reset(slot.x, slot.z, slot.rotY)

    if (net && net.isConnected()) {
      net.sendRespawn([slot.x, 0.45, slot.z], [0, 0, 0, 1])
    }
  }

  public toggleReady(context: ModeContext): void {
    const net = context.networkManager
    if (!net || !net.isConnected()) return
    this.localReady = !this.localReady
    net.sendReadyToggle(this.localReady)
  }

  public onUpdate(delta: number, context: ModeContext): void {
    const carPos = context.vehicle.root.position
    const carQuat = context.vehicle.root.quaternion
    const carSpeed = context.vehicle.currentSpeed
    const raceTrack = context.raceTrack

    const net = context.networkManager
    const currentRoom = net?.getCurrentRoom()
    const isOnlineRace = !!(net && net.isConnected() && currentRoom && currentRoom.mode === 'RACE')

    // --- MULTIPLAYER ONLINE RACE FLOW ---
    if (isOnlineRace) {
      const raceState = currentRoom.raceState || OnlineRaceState.LOBBY
      const isLocked = raceState === OnlineRaceState.LOBBY || raceState === OnlineRaceState.COUNTDOWN

      // 1. Lock vehicle movement during Lobby or Countdown
      if (isLocked) {
        context.vehicle.currentSpeed = 0
        const lin = context.vehicle.rigidBody.linvel()
        context.vehicle.rigidBody.setLinvel({ x: 0, y: lin.y, z: 0 }, true)
        context.vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
      }

      // 2. Check Direction Alignment (Wrong Way Detection)
      const checkpoints = raceTrack.checkpoints
      const targetCp = checkpoints[this.raceSystem.nextCheckpointIndex]
      if (targetCp) {
        this.tempCarForward.set(0, 0, 1).applyQuaternion(carQuat)
        const dot = this.tempCarForward.dot(targetCp.forward)
        const isWrongWay = Math.abs(carSpeed) > 3.0 && dot < -0.3
        context.hud.setWrongWayVisible?.(isWrongWay)

        // 3. Proximity Check & Authoritative Checkpoint Passing
        if (raceState === OnlineRaceState.RACING) {
          const dist = Math.hypot(carPos.x - targetCp.position.x, carPos.z - targetCp.position.z)
          const now = Date.now()

          if (dist <= targetCp.radius + 4.0 && dot > -0.2 && now - this.lastPassTime > 750) {
            this.lastPassTime = now
            const passingIndex = this.raceSystem.nextCheckpointIndex

            // Advance local lap prediction
            if (passingIndex === 0) {
              this.raceSystem.currentLap++
              this.raceSystem.nextCheckpointIndex = 1
            } else {
              this.raceSystem.nextCheckpointIndex = (passingIndex + 1) % checkpoints.length
            }

            // Send authoritative checkpoint pass request to server
            net.sendCheckpointPass(passingIndex, this.raceSystem.currentLap, [carPos.x, carPos.y, carPos.z])
          }
        }
      }

      // 4. Update Racing HUD Telemetry
      const lapText = `TUR ${Math.min(this.raceSystem.currentLap, 2)}/2`
      const timeText = this.raceSystem.formatTime(this.raceSystem.currentLapTime)
      const bestText =
        this.raceSystem.bestLapTime !== null ? this.raceSystem.formatTime(this.raceSystem.bestLapTime) : '--:--.--'
      const cpText =
        this.raceSystem.nextCheckpointIndex === 0
          ? 'Bitiş Çizgisine İlerle!'
          : `Sektör ${this.raceSystem.nextCheckpointIndex}/5`

      // Calculate local player position rank
      let posText = 'P1'
      if (currentRoom.players && currentRoom.players.length > 0) {
        const myId = net.getPlayerId()
        const myIndex = currentRoom.players.findIndex((p) => p.id === myId)
        const rank = myIndex >= 0 ? myIndex + 1 : 1
        posText = `P${rank}/${currentRoom.players.length}`
      }

      context.hud.updateRaceTelemetry(lapText, timeText, bestText, cpText, posText)

      if (raceState === OnlineRaceState.RACING) {
        this.raceSystem.currentLapTime += delta
      }
      return
    }

    // --- SINGLE-PLAYER OFFLINE FALLBACK ---
    const raceUpdate = this.raceSystem.update(
      delta,
      carPos,
      carQuat,
      carSpeed,
      raceTrack
    )

    if (raceUpdate.isControlLocked) {
      context.vehicle.currentSpeed = 0
      const lin = context.vehicle.rigidBody.linvel()
      context.vehicle.rigidBody.setLinvel({ x: 0, y: lin.y, z: 0 }, true)
      context.vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }

    if (raceUpdate.countdownText !== this.lastCountdownText) {
      if (
        raceUpdate.countdownText === '3' ||
        raceUpdate.countdownText === '2' ||
        raceUpdate.countdownText === '1'
      ) {
        context.audio?.playCountdown(false)
      } else if (raceUpdate.countdownText === 'BAŞLA! 🏁') {
        context.audio?.playCountdown(true)
      }
      this.lastCountdownText = raceUpdate.countdownText
    }

    context.hud.setRaceCountdown?.(raceUpdate.countdownText, raceUpdate.countdownColor)
    context.hud.setWrongWayVisible?.(raceUpdate.isWrongWay)

    const lapText = `TUR ${raceUpdate.currentLap}/${raceUpdate.totalLaps}`
    const timeText = this.raceSystem.formatTime(raceUpdate.currentLapTime)
    const bestText =
      raceUpdate.bestLapTime !== null ? this.raceSystem.formatTime(raceUpdate.bestLapTime) : '--:--.--'
    const cpText = raceUpdate.checkpointText

    context.hud.updateRaceTelemetry(lapText, timeText, bestText, cpText, 'P1')

    if (raceUpdate.lapMessage) {
      if (raceUpdate.state === RaceState.FINISHED) {
        context.hud.setSubtitle(`★ ${raceUpdate.lapMessage} ★`, '#facc15')
      } else if (raceUpdate.isWrongWay) {
        context.hud.setSubtitle('⚠️ TERS YÖN! ARACI DÜZELT', '#ef4444')
      } else {
        context.hud.setSubtitle(raceUpdate.lapMessage, '#38bdf8')
      }
    }

    if (raceUpdate.state === RaceState.FINISHED && raceUpdate.result && !this.resultsShown) {
      this.resultsShown = true
      context.audio?.playFinish()
      context.hud.showRaceResults?.(raceUpdate.result)
    }
  }

  public onExit(context: ModeContext): void {
    context.hud.setRaceCountdown?.(null)
    context.hud.setWrongWayVisible?.(false)
    context.hud.hideRaceResults?.()

    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
  }

  public onReset(context: ModeContext): void {
    this.resultsShown = false
    context.hud.hideRaceResults?.()
    context.hud.setWrongWayVisible?.(false)

    if (this.isOnlineSession) {
      this.resetToGrid(context)
      context.hud.setSubtitle('Yarış Gridine Dönüldü • Hazır Ol', this.badgeColor)
    } else {
      const pole = context.raceTrack.getPolePosition()
      context.vehicle.reset(pole.position.x, pole.position.z, pole.rotationY)
      this.raceSystem.startRace(context.raceTrack)
      context.hud.setSubtitle('Yarış Sıfırlandı • 3 Tur Başlıyor', this.badgeColor)
    }
  }

  // --- ONLINE RACE EVENT HANDLERS ---

  private handleRoomUpdate(payload: RaceRoomUpdatePayload, context: ModeContext): void {
    const net = context.networkManager
    const myId = net?.getPlayerId()
    if (myId) {
      const me = payload.players.find((p) => p.id === myId)
      if (me) {
        this.localReady = !!me.isReady
      }
    }

    if (payload.raceState === OnlineRaceState.LOBBY) {
      context.hud.setSubtitle('Yarış Lobisi • Başlamak İçin Herkes Hazır Olmalı', this.badgeColor)
    }
  }

  private handleServerCountdown(payload: RaceStartCountdownPayload, context: ModeContext): void {
    context.hud.setSubtitle('⏱️ GERİ SAYIM BAŞLADI!', '#f59e0b')
    context.hud.setRaceCountdown?.(payload.countdownSeconds.toString(), '#f59e0b')
    context.audio?.playCountdown(false)
  }

  private handleServerStarted(_payload: RaceStartedPayload, context: ModeContext): void {
    this.raceSystem.currentLapTime = 0
    this.raceSystem.currentLap = 1
    this.raceSystem.nextCheckpointIndex = 1
    this.resultsShown = false

    context.hud.setSubtitle('🏁 YARIŞ BAŞLADI! TAM GAZ!', '#22c55e')
    context.hud.setRaceCountdown?.('BAŞLA! 🏁', '#22c55e')
    context.audio?.playCountdown(true)

    setTimeout(() => {
      context.hud.setRaceCountdown?.(null)
    }, 1200)
  }

  private handleServerProgress(_payload: RaceProgressPayload, _context: ModeContext): void {
    // Progress is also handled by main HUD standings overlay
  }

  private handlePlayerFinished(result: RaceParticipantResult, context: ModeContext): void {
    const net = context.networkManager
    if (net && net.getPlayerId() === result.playerId) {
      context.audio?.playFinish()
      context.hud.setSubtitle(`🏁 ${result.rank}. BİTİRDİN! (${result.totalTime.toFixed(1)}s)`, '#facc15')
    }
  }

  private handleServerResults(payload: RaceResultsPayload, context: ModeContext): void {
    if (this.resultsShown) return
    this.resultsShown = true

    context.hud.setRaceCountdown?.(null)
    context.hud.showMultiplayerRaceResults?.(payload.results)
  }

  private handleServerRematch(context: ModeContext): void {
    this.resultsShown = false
    this.localReady = false
    context.hud.hideRaceResults?.()
    this.resetToGrid(context)
    context.hud.setSubtitle('Yarış Yenilendi • Tekrar Hazır Ol', this.badgeColor)
  }

  public getRespawnPoint(context: ModeContext): { position: THREE.Vector3; rotationY: number; name: string } {
    const checkpoints = context.raceTrack.checkpoints
    if (!checkpoints || checkpoints.length === 0) {
      const pole = context.raceTrack.getPolePosition()
      return { position: pole.position.clone(), rotationY: pole.rotationY, name: pole.name }
    }

    // If on Lap 1 before crossing checkpoint 1
    if (this.raceSystem.currentLap === 1 && this.raceSystem.nextCheckpointIndex === 1) {
      if (this.isOnlineSession) {
        const slot = RaceMode.GRID_POSITIONS[this.assignedGridIndex % RaceMode.GRID_POSITIONS.length]
        return {
          position: new THREE.Vector3(slot.x, 0.45, slot.z),
          rotationY: slot.rotY,
          name: `Başlangıç Grid #${this.assignedGridIndex + 1}`,
        }
      }
      const pole = context.raceTrack.getPolePosition()
      return { position: pole.position.clone(), rotationY: pole.rotationY, name: pole.name }
    }

    // Last passed checkpoint
    const totalCp = checkpoints.length
    const lastCpIndex = (this.raceSystem.nextCheckpointIndex - 1 + totalCp) % totalCp
    return context.raceTrack.getCheckpointRespawn(lastCpIndex)
  }

  public getRaceSystem(): RaceSystem {
    return this.raceSystem
  }
}

