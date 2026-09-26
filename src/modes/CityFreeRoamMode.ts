import * as THREE from 'three'
import { type IGameMode, GameModeType, MapType, type ModeContext } from './types.ts'

export class CityFreeRoamMode implements IGameMode {
  public readonly modeType = GameModeType.CITY_FREE_ROAM
  public readonly mapType = MapType.CITY
  public readonly title = 'Şehirde Serbest Gezinti'
  public readonly subtitle = 'Serbest Sürüş & Keşif'
  public readonly description = 'Caddeler, kavşaklar, gökdelenler ve parklar arasında kuralsız serbest sürüş keyfi.'
  public readonly icon = '🏙️'
  public readonly badgeColor = '#3b82f6'

  public currentSpawnIndex: number = 0

  public onEnter(context: ModeContext): void {
    context.cityWorld.group.visible = true
    context.raceTrack.setVisible(false)
    context.driftTrack.setVisible(false)

    context.hud.setTelemetryVisible(false)
    context.hud.setDriftCardVisible(false)
    context.hud.setCityCardVisible?.(true)
    context.hud.setSpawnButtonVisible(true)
    context.hud.setSubtitle('Şehir • Serbest Gezinti', this.badgeColor)

    this.applySpawn(context, this.currentSpawnIndex)
  }

  private smokeTimer = 0
  private cityHudTimer = 0
  private tempWheelL = new THREE.Vector3()
  private tempWheelR = new THREE.Vector3()
  private tempCarVel = new THREE.Vector3()

  public onUpdate(delta: number, context: ModeContext): void {
    if (
      context.tireSmoke &&
      (context.vehicle.isDrifting || (context.vehicle.isHandbrakeActive && Math.abs(context.vehicle.currentSpeed) > 3.0))
    ) {
      this.smokeTimer += delta
      if (this.smokeTimer >= 0.035) {
        this.smokeTimer = 0
        context.vehicle.getRearWheelPositions(this.tempWheelL, this.tempWheelR)
        const linvel = context.vehicle.rigidBody.linvel()
        this.tempCarVel.set(linvel.x, linvel.y, linvel.z)
        context.tireSmoke.emit(this.tempWheelL, this.tempCarVel)
        context.tireSmoke.emit(this.tempWheelR, this.tempCarVel)
      }
    }

    // Refresh city HUD online count periodically
    this.cityHudTimer += delta
    if (this.cityHudTimer >= 0.5) {
      this.cityHudTimer = 0
      const currentRoom = context.networkManager?.getCurrentRoom()
      const onlineCount = currentRoom && currentRoom.mode === 'CITY_FREE_ROAM' ? currentRoom.players.length : 1
      const locations = context.cityWorld.spawnLocations
      const spawn = locations[this.currentSpawnIndex % locations.length]
      context.hud.updateCityHUD?.(onlineCount, spawn.name, `Konum ${this.currentSpawnIndex + 1}/${locations.length}`)
    }
  }

  public onExit(context: ModeContext): void {
    context.hud.setCityCardVisible?.(false)
    if (context.tireSmoke) {
      context.tireSmoke.reset()
    }
  }

  public onReset(context: ModeContext): void {
    this.applySpawn(context, this.currentSpawnIndex)
  }

  public getRespawnPoint(context: ModeContext): { position: THREE.Vector3; rotationY: number; name: string } {
    const loc = context.cityWorld.getNearestSpawnLocation(context.vehicle.root.position)
    return {
      position: loc.position.clone(),
      rotationY: loc.rotationY,
      name: loc.name,
    }
  }

  public cycleSpawn(context: ModeContext): void {
    const locations = context.cityWorld.spawnLocations
    this.currentSpawnIndex = (this.currentSpawnIndex + 1) % locations.length
    this.applySpawn(context, this.currentSpawnIndex)
  }

  private applySpawn(context: ModeContext, index: number): void {
    const locations = context.cityWorld.spawnLocations
    const spawn = locations[index % locations.length]
    context.vehicle.reset(spawn.position.x, spawn.position.z, spawn.rotationY)
    context.hud.setSubtitle(`${spawn.name} (${index + 1}/${locations.length})`, '#38bdf8')
    context.hud.setSpawnText?.(`Konum ${index + 1}/${locations.length}`)

    const currentRoom = context.networkManager?.getCurrentRoom()
    const onlineCount = currentRoom && currentRoom.mode === 'CITY_FREE_ROAM' ? currentRoom.players.length : 1
    context.hud.updateCityHUD?.(onlineCount, spawn.name, `Konum ${index + 1}/${locations.length}`)
  }
}
