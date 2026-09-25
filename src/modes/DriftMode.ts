import * as THREE from 'three'
import { type IGameMode, GameModeType, MapType, type ModeContext } from './types.ts'
import { DriftSystem } from '../drift/DriftSystem.ts'

export class DriftMode implements IGameMode {
  public readonly modeType = GameModeType.DRIFT
  public readonly mapType = MapType.DRIFT_TRACK
  public readonly title = 'Drift & Slalom Parkuru'
  public readonly subtitle = 'Özel Drift Arenası & Slalom'
  public readonly description = 'Geniş asfalt pist, Omega virajı, Donut drift meydanı, S-şikanlar ve özel drift bölgeleri.'
  public readonly icon = '⚡'
  public readonly badgeColor = '#f59e0b'

  public currentSpawnIndex: number = 0
  private driftSystem = new DriftSystem()
  private smokeTimer = 0
  private tempWheelL = new THREE.Vector3()
  private tempWheelR = new THREE.Vector3()
  private tempCarVel = new THREE.Vector3()

  public onEnter(context: ModeContext): void {
    context.cityWorld.group.visible = false
    context.raceTrack.setVisible(false)
    context.driftTrack.setVisible(true)

    context.hud.setTelemetryVisible(false)
    context.hud.setSpawnButtonVisible(true)
    context.hud.setDriftCardVisible(true)

    this.driftSystem.reset()
    this.applySpawn(context, this.currentSpawnIndex)
  }

  public onUpdate(delta: number, context: ModeContext): void {
    // 1. Check if vehicle is inside any dedicated Drift Zone
    const { activeZone, bonusMultiplier } = context.driftTrack.update(delta, context.vehicle.root.position)

    // 2. Update Drift Scoring Engine with Zone Bonus
    const driftState = this.driftSystem.update(delta, context.vehicle, bonusMultiplier)

    // 3. Emit Tire Smoke during drift slides or handbrake turns
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

    // 4. Format HUD Telemetry
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

  public onExit(context: ModeContext): void {
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
