import { type IGameMode, GameModeType, MapType, type ModeContext } from './types.ts'
import { RaceSystem, RaceState } from '../race/RaceSystem.ts'

export class RaceMode implements IGameMode {
  public readonly modeType = GameModeType.RACE
  public readonly mapType = MapType.RACE_TRACK
  public readonly title = 'Grand Prix Yarışı'
  public readonly subtitle = 'Kapalı Pist & 3 Tur Mücadelesi'
  public readonly description = 'Zorlu virajlar, şikanlar, apex kerbleri, kalkış geri sayımı ve 3 turluk Grand Prix mücadelesi.'
  public readonly icon = '🏁'
  public readonly badgeColor = '#ef4444'

  private raceSystem = new RaceSystem()
  private resultsShown = false

  public onEnter(context: ModeContext): void {
    context.cityWorld.group.visible = false
    context.raceTrack.setVisible(true)
    context.driftTrack.setVisible(false)

    context.hud.setTelemetryVisible(true)
    context.hud.setDriftCardVisible(false)
    context.hud.setSpawnButtonVisible(false)
    context.hud.hideRaceResults?.()
    context.hud.setWrongWayVisible?.(false)
    context.hud.setSubtitle('Grand Prix • 3 Tur Mücadelesi', this.badgeColor)

    this.resultsShown = false
    const pole = context.raceTrack.getPolePosition()
    context.vehicle.reset(pole.position.x, pole.position.z, pole.rotationY)

    this.raceSystem.startRace(context.raceTrack)
  }

  public onUpdate(delta: number, context: ModeContext): void {
    const raceUpdate = this.raceSystem.update(
      delta,
      context.vehicle.root.position,
      context.vehicle.root.quaternion,
      context.vehicle.currentSpeed,
      context.raceTrack
    )

    // 1. Lock vehicle movement during 3... 2... 1... countdown
    if (raceUpdate.isControlLocked) {
      context.vehicle.currentSpeed = 0
      const lin = context.vehicle.rigidBody.linvel()
      context.vehicle.rigidBody.setLinvel({ x: 0, y: lin.y, z: 0 }, true)
      context.vehicle.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }

    // 2. Update Countdown Display
    context.hud.setRaceCountdown?.(raceUpdate.countdownText, raceUpdate.countdownColor)

    // 3. Update Reverse / Wrong Way Warning
    context.hud.setWrongWayVisible?.(raceUpdate.isWrongWay)

    // 4. Update Racing HUD Telemetry
    const lapText = `TUR ${raceUpdate.currentLap}/${raceUpdate.totalLaps}`
    const timeText = this.raceSystem.formatTime(raceUpdate.currentLapTime)
    const bestText =
      raceUpdate.bestLapTime !== null ? this.raceSystem.formatTime(raceUpdate.bestLapTime) : '--:--.--'
    const cpText = raceUpdate.checkpointText

    context.hud.updateRaceTelemetry(lapText, timeText, bestText, cpText)

    // 5. Update Status Banner
    if (raceUpdate.lapMessage) {
      if (raceUpdate.state === RaceState.FINISHED) {
        context.hud.setSubtitle(`★ ${raceUpdate.lapMessage} ★`, '#facc15')
      } else if (raceUpdate.isWrongWay) {
        context.hud.setSubtitle('⚠️ TERS YÖN! ARACI DÜZELT', '#ef4444')
      } else {
        context.hud.setSubtitle(raceUpdate.lapMessage, '#38bdf8')
      }
    }

    // 6. Handle Race Finish & Results Screen
    if (raceUpdate.state === RaceState.FINISHED && raceUpdate.result && !this.resultsShown) {
      this.resultsShown = true
      context.hud.showRaceResults?.(raceUpdate.result)
    }
  }

  public onExit(context: ModeContext): void {
    context.hud.setRaceCountdown?.(null)
    context.hud.setWrongWayVisible?.(false)
    context.hud.hideRaceResults?.()
  }

  public onReset(context: ModeContext): void {
    this.resultsShown = false
    context.hud.hideRaceResults?.()
    context.hud.setWrongWayVisible?.(false)

    const pole = context.raceTrack.getPolePosition()
    context.vehicle.reset(pole.position.x, pole.position.z, pole.rotationY)

    this.raceSystem.startRace(context.raceTrack)
    context.hud.setSubtitle('Yarış Sıfırlandı • 3 Tur Başlıyor', this.badgeColor)
  }

  public getRaceSystem(): RaceSystem {
    return this.raceSystem
  }
}
